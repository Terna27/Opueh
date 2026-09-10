package auth

import (
	"strings"
	"testing"
)

func TestHashPassword_ProducesArgon2idPHC(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}

	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Errorf("hash is not argon2id PHC format: %q", hash)
	}
	if strings.Contains(hash, "correct horse battery staple") {
		t.Error("hash contains the plaintext password")
	}
}

func TestVerifyPassword_CorrectPassword(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}

	ok, err := VerifyPassword(hash, "correct horse battery staple")
	if err != nil {
		t.Fatalf("VerifyPassword: %v", err)
	}
	if !ok {
		t.Error("correct password failed verification")
	}
}

func TestVerifyPassword_WrongPassword(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}

	ok, err := VerifyPassword(hash, "Tr0ub4dor&3")
	if err != nil {
		t.Fatalf("VerifyPassword: %v", err)
	}
	if ok {
		t.Error("wrong password passed verification")
	}
}

func TestHashPassword_UniqueSalts(t *testing.T) {
	h1, err := HashPassword("same-password")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	h2, err := HashPassword("same-password")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}

	if h1 == h2 {
		t.Error("two hashes of the same password are identical (salt reuse)")
	}

	ok1, _ := VerifyPassword(h1, "same-password")
	ok2, _ := VerifyPassword(h2, "same-password")
	if !ok1 || !ok2 {
		t.Error("both hashes should verify against the same password")
	}
}

func TestVerifyPassword_MalformedHashes(t *testing.T) {
	malformed := []string{
		"",
		"not-a-hash",
		"$argon2id$v=19$m=65536,t=1,p=2$onlysalt",
		"$argon2i$v=19$m=65536,t=1,p=2$c2FsdA$a2V5",
		"$argon2id$v=19$m=65536,t=1$xx$yy",
		"$argon2id$v=99$m=65536,t=1,p=2$c2FsdA$a2V5",
		"$argon2id$v=19$m=65536,t=1,p=2$not!base64$a2V5",
		"$argon2id$v=19$m=65536,t=1,p=0$c2FsdA$a2V5",
		"$argon2id$v=19$m=65536,t=1,p=300$c2FsdA$a2V5",
	}

	for _, hash := range malformed {
		if _, err := VerifyPassword(hash, "password"); err == nil {
			t.Errorf("malformed hash %q did not produce an error", hash)
		}
	}
}
