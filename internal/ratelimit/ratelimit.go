// Package ratelimit defines the rate-limiting contract used by sensitive
// endpoints (verification resend, password-reset requests). The interface is
// deliberately provider-agnostic: the current implementation is an in-memory
// fixed-window limiter suitable for a single instance; a Redis-backed
// implementation can be dropped in later without touching services.
package ratelimit

import (
	"context"
	"sync"
	"time"
)

// Limiter reports whether the action identified by key is allowed right now.
// Keys are caller-scoped: the caller composes them (e.g. "pwreset:ip:1.2.3.4"
// or "verify:user:<uuid>") so different limits never collide.
//
// An error means the limiter itself failed (e.g. Redis unreachable), not that
// the action is disallowed — callers decide whether to fail open or closed.
type Limiter interface {
	Allow(ctx context.Context, key string) (bool, error)
}

// MemoryLimiter is a fixed-window in-memory limiter: at most `limit` allowed
// actions per `window` per key. Safe for concurrent use. Suitable for local
// development and single-instance deployments; state does not survive
// restarts and is not shared between replicas.
type MemoryLimiter struct {
	limit  int
	window time.Duration

	mu      sync.Mutex
	buckets map[string]*bucket
}

type bucket struct {
	count     int
	windowEnd time.Time
}

// NewMemoryLimiter constructs a limiter allowing `limit` actions per window.
func NewMemoryLimiter(limit int, window time.Duration) *MemoryLimiter {
	return &MemoryLimiter{
		limit:   limit,
		window:  window,
		buckets: make(map[string]*bucket),
	}
}

// Allow consumes one unit for key if the limit is not exceeded.
func (l *MemoryLimiter) Allow(ctx context.Context, key string) (bool, error) {
	now := time.Now()

	l.mu.Lock()
	defer l.mu.Unlock()

	// Opportunistic cleanup: prune expired buckets once the map grows past
	// a threshold so long-running processes don't accumulate keys forever.
	if len(l.buckets) > 10_000 {
		for k, b := range l.buckets {
			if now.After(b.windowEnd) {
				delete(l.buckets, k)
			}
		}
	}

	b, ok := l.buckets[key]
	if !ok || now.After(b.windowEnd) {
		l.buckets[key] = &bucket{count: 1, windowEnd: now.Add(l.window)}
		return true, nil
	}

	if b.count >= l.limit {
		return false, nil
	}
	b.count++
	return true, nil
}

// NoopLimiter allows everything. Used in tests that don't exercise limits.
type NoopLimiter struct{}

// Allow always returns true.
func (NoopLimiter) Allow(ctx context.Context, key string) (bool, error) { return true, nil }

// FailureTracker implements temporary lockout for repeated failed actions:
// once `threshold` failures are recorded within `window` for a key, that key
// is locked for `lockout`. A locked key is never extended while locked (the
// lockout always has a fixed end), so an account can never be permanently
// disabled by an attacker. Safe for concurrent use.
//
// Like MemoryLimiter this is an in-memory single-instance implementation; a
// Redis-backed tracker can replace it later behind the same methods.
type FailureTracker struct {
	threshold int
	window    time.Duration
	lockout   time.Duration

	// Clock defaults to time.Now. Tests override it to advance time
	// deterministically instead of sleeping.
	Clock func() time.Time

	mu      sync.Mutex
	entries map[string]*failureEntry
}

type failureEntry struct {
	count       int
	windowStart time.Time
	lockedUntil time.Time
}

// NewFailureTracker constructs a tracker that locks a key for `lockout`
// after `threshold` failures within any `window`.
func NewFailureTracker(threshold int, window, lockout time.Duration) *FailureTracker {
	return &FailureTracker{
		threshold: threshold,
		window:    window,
		lockout:   lockout,
		Clock:     time.Now,
		entries:   make(map[string]*failureEntry),
	}
}

func (t *FailureTracker) now() time.Time {
	if t.Clock != nil {
		return t.Clock()
	}
	return time.Now()
}

// IsLocked reports whether the key is currently locked out.
func (t *FailureTracker) IsLocked(ctx context.Context, key string) (bool, error) {
	now := t.now()

	t.mu.Lock()
	defer t.mu.Unlock()

	e, ok := t.entries[key]
	if !ok {
		return false, nil
	}
	if now.Before(e.lockedUntil) {
		return true, nil
	}
	// The lockout (if any) has elapsed: the key is free again and its
	// failure state starts fresh.
	if !e.lockedUntil.IsZero() {
		delete(t.entries, key)
	}
	return false, nil
}

// RecordFailure adds one failure to the key's count, locking the key when
// the threshold is reached within the window. Failures recorded while the
// key is already locked are ignored — they must not extend the lockout.
func (t *FailureTracker) RecordFailure(ctx context.Context, key string) error {
	now := t.now()

	t.mu.Lock()
	defer t.mu.Unlock()

	// Opportunistic cleanup, same policy as MemoryLimiter.
	if len(t.entries) > 10_000 {
		for k, e := range t.entries {
			if now.After(e.windowStart.Add(t.window)) && now.After(e.lockedUntil) {
				delete(t.entries, k)
			}
		}
	}

	e, ok := t.entries[key]
	if !ok {
		e = &failureEntry{windowStart: now}
		t.entries[key] = e
	}

	// Locked: do nothing (never extend).
	if now.Before(e.lockedUntil) {
		return nil
	}

	// Failures older than the window no longer count.
	if now.After(e.windowStart.Add(t.window)) {
		e.count = 0
		e.windowStart = now
	}

	e.count++
	if e.count >= t.threshold {
		e.lockedUntil = now.Add(t.lockout)
		// The lockout replaces the failure window: after it expires the
		// counter starts from zero (IsLocked deletes the entry).
		e.count = 0
		e.windowStart = now
	}
	return nil
}

// Reset clears all failure state for the key — called after a successful
// authentication so earlier mistakes don't count against the user.
func (t *FailureTracker) Reset(ctx context.Context, key string) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.entries, key)
	return nil
}
