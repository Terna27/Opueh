package ratelimit

import (
	"context"
	"sync"
	"testing"
	"time"
)

// fakeClock is a controllable clock so lockout expiry is tested by moving
// time forward, not by sleeping.
type fakeClock struct{ t time.Time }

func (c *fakeClock) Now() time.Time          { return c.t }
func (c *fakeClock) Advance(d time.Duration) { c.t = c.t.Add(d) }

func TestFailureTracker_LocksAfterThreshold(t *testing.T) {
	tr := NewFailureTracker(3, 15*time.Minute, 15*time.Minute)
	ctx := context.Background()

	for i := 0; i < 2; i++ {
		if err := tr.RecordFailure(ctx, "key"); err != nil {
			t.Fatalf("RecordFailure: %v", err)
		}
		if locked, _ := tr.IsLocked(ctx, "key"); locked {
			t.Fatalf("locked after only %d failures", i+1)
		}
	}

	if err := tr.RecordFailure(ctx, "key"); err != nil {
		t.Fatalf("RecordFailure: %v", err)
	}
	if locked, _ := tr.IsLocked(ctx, "key"); !locked {
		t.Error("key not locked after reaching the failure threshold")
	}
}

func TestFailureTracker_LockoutIsTemporary(t *testing.T) {
	clock := &fakeClock{t: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)}
	tr := NewFailureTracker(2, 15*time.Minute, 15*time.Minute)
	tr.Clock = clock.Now
	ctx := context.Background()

	tr.RecordFailure(ctx, "key")
	tr.RecordFailure(ctx, "key")

	if locked, _ := tr.IsLocked(ctx, "key"); !locked {
		t.Fatal("key should be locked immediately after the threshold")
	}

	// Advance past the lockout: the key must be free again — a lockout can
	// never be permanent.
	clock.Advance(16 * time.Minute)
	if locked, _ := tr.IsLocked(ctx, "key"); locked {
		t.Error("key still locked after the lockout duration elapsed")
	}

	// And it takes a full new threshold of failures to lock it again (the
	// pre-lockout failures don't carry over).
	tr.RecordFailure(ctx, "key")
	if locked, _ := tr.IsLocked(ctx, "key"); locked {
		t.Error("a single post-lockout failure re-locked the key")
	}
}

func TestFailureTracker_FailuresOutsideWindowDoNotAccumulate(t *testing.T) {
	clock := &fakeClock{t: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)}
	tr := NewFailureTracker(3, 10*time.Minute, 15*time.Minute)
	tr.Clock = clock.Now
	ctx := context.Background()

	// Failures spaced further apart than the window never reach the
	// threshold together.
	for i := 0; i < 5; i++ {
		tr.RecordFailure(ctx, "key")
		clock.Advance(11 * time.Minute)
	}
	if locked, _ := tr.IsLocked(ctx, "key"); locked {
		t.Error("spread-out failures locked the key")
	}
}

func TestFailureTracker_ResetClearsFailures(t *testing.T) {
	tr := NewFailureTracker(3, 15*time.Minute, 15*time.Minute)
	ctx := context.Background()

	tr.RecordFailure(ctx, "key")
	tr.RecordFailure(ctx, "key")
	if err := tr.Reset(ctx, "key"); err != nil {
		t.Fatalf("Reset: %v", err)
	}

	// After a reset it takes the full threshold again.
	tr.RecordFailure(ctx, "key")
	tr.RecordFailure(ctx, "key")
	if locked, _ := tr.IsLocked(ctx, "key"); locked {
		t.Error("key locked using failures that preceded a Reset")
	}

	// Reset while not locked and on an unknown key are both safe.
	if err := tr.Reset(ctx, "unknown-key"); err != nil {
		t.Errorf("Reset on unknown key: %v", err)
	}
}

func TestFailureTracker_LockedKeyNotExtendedByFurtherFailures(t *testing.T) {
	clock := &fakeClock{t: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)}
	tr := NewFailureTracker(2, 15*time.Minute, 10*time.Minute)
	tr.Clock = clock.Now
	ctx := context.Background()

	tr.RecordFailure(ctx, "key")
	tr.RecordFailure(ctx, "key") // locked until 12:10

	// Failures arriving during the lockout must not push the end out.
	clock.Advance(9 * time.Minute)
	tr.RecordFailure(ctx, "key")
	clock.Advance(2 * time.Minute) // 12:11 — past the original lockout

	if locked, _ := tr.IsLocked(ctx, "key"); locked {
		t.Error("lockout was extended by failures recorded while already locked")
	}
}

func TestFailureTracker_KeysAreIndependent(t *testing.T) {
	tr := NewFailureTracker(1, time.Minute, time.Minute)
	ctx := context.Background()

	tr.RecordFailure(ctx, "alice")
	if locked, _ := tr.IsLocked(ctx, "bob"); locked {
		t.Error("one key's lockout affected another key")
	}
	if locked, _ := tr.IsLocked(ctx, "alice"); !locked {
		t.Error("key not locked at threshold 1")
	}
}

func TestFailureTracker_ConcurrentUse(t *testing.T) {
	tr := NewFailureTracker(100, time.Minute, time.Minute)
	ctx := context.Background()

	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = tr.RecordFailure(ctx, "shared")
		}()
	}
	wg.Wait()

	if locked, _ := tr.IsLocked(ctx, "shared"); !locked {
		t.Error("key not locked after 200 concurrent failures (threshold 100)")
	}
}
