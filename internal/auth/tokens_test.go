package auth

import (
	"strings"
	"testing"
)

func TestGenerateRefreshToken_Format(t *testing.T) {
	token, err := GenerateRefreshToken()
	if err != nil {
		t.Fatalf("GenerateRefreshToken: %v", err)
	}

	if !strings.HasPrefix(token, "rt_") {
		t.Errorf("token %q missing rt_ prefix", token)
	}
	if len(token) < 40 {
		t.Errorf("token too short for 256-bit entropy: %d chars", len(token))
	}
}

func TestGenerateRefreshToken_Unique(t *testing.T) {
	seen := make(map[string]bool, 128)
	for i := 0; i < 128; i++ {
		token, err := GenerateRefreshToken()
		if err != nil {
			t.Fatalf("GenerateRefreshToken: %v", err)
		}
		if seen[token] {
			t.Fatalf("duplicate token generated: %q", token)
		}
		seen[token] = true
	}
}

func TestHashToken_Properties(t *testing.T) {
	token, err := GenerateRefreshToken()
	if err != nil {
		t.Fatalf("GenerateRefreshToken: %v", err)
	}

	h1 := HashToken(token)
	h2 := HashToken(token)

	if len(h1) != 64 {
		t.Errorf("hash length = %d, want 64 hex chars (SHA-256)", len(h1))
	}
	if h1 != h2 {
		t.Error("hashing is not deterministic")
	}

	other, _ := GenerateRefreshToken()
	if HashToken(other) == h1 {
		t.Error("different tokens produced the same hash")
	}

	if strings.Contains(h1, token) {
		t.Error("hash contains the plaintext token")
	}
}
