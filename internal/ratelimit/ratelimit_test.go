package ratelimit

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestMemoryLimiter_AllowsUpToLimit(t *testing.T) {
	l := NewMemoryLimiter(3, time.Minute)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		allowed, err := l.Allow(ctx, "key")
		if err != nil {
			t.Fatalf("Allow: %v", err)
		}
		if !allowed {
			t.Fatalf("request %d was denied under the limit", i+1)
		}
	}

	if allowed, _ := l.Allow(ctx, "key"); allowed {
		t.Error("request over the limit was allowed")
	}
}

func TestMemoryLimiter_KeysAreIndependent(t *testing.T) {
	l := NewMemoryLimiter(1, time.Minute)
	ctx := context.Background()

	if allowed, _ := l.Allow(ctx, "a"); !allowed {
		t.Error("first key denied")
	}
	if allowed, _ := l.Allow(ctx, "a"); allowed {
		t.Error("second request on same key allowed")
	}
	if allowed, _ := l.Allow(ctx, "b"); !allowed {
		t.Error("different key affected by another key's limit")
	}
}

func TestMemoryLimiter_WindowReset(t *testing.T) {
	l := NewMemoryLimiter(1, 20*time.Millisecond)
	ctx := context.Background()

	if allowed, _ := l.Allow(ctx, "key"); !allowed {
		t.Fatal("first request denied")
	}
	if allowed, _ := l.Allow(ctx, "key"); allowed {
		t.Fatal("second request within window allowed")
	}

	time.Sleep(30 * time.Millisecond)
	if allowed, _ := l.Allow(ctx, "key"); !allowed {
		t.Error("request after window expiry was denied")
	}
}

func TestMemoryLimiter_ConcurrentUse(t *testing.T) {
	l := NewMemoryLimiter(50, time.Minute)
	ctx := context.Background()

	var mu sync.Mutex
	allowedCount := 0
	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ok, err := l.Allow(ctx, "shared")
			if err != nil {
				t.Errorf("Allow: %v", err)
				return
			}
			if ok {
				mu.Lock()
				allowedCount++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	if allowedCount != 50 {
		t.Errorf("allowed %d requests, want exactly the limit of 50", allowedCount)
	}
}

func TestNoopLimiter(t *testing.T) {
	var l Limiter = NoopLimiter{}
	for i := 0; i < 100; i++ {
		allowed, err := l.Allow(context.Background(), "anything")
		if err != nil || !allowed {
			t.Fatalf("NoopLimiter denied or errored: allowed=%v err=%v", allowed, err)
		}
	}
}
