package email

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
)

func TestDevSender_LogsMessage(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))

	sender := NewDevSender(logger)
	err := sender.Send(context.Background(), Message{
		To:      "jane@example.com",
		Subject: "Verify your email address",
		Body:    "Verify here: http://localhost:3000/verify-email?token=evt_abc",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	logged := buf.String()
	if !strings.Contains(logged, "dev_email_delivered") {
		t.Errorf("expected dev_email_delivered event, got: %s", logged)
	}
	if !strings.Contains(logged, "jane@example.com") {
		t.Errorf("recipient not logged: %s", logged)
	}
	if !strings.Contains(logged, "evt_abc") {
		t.Errorf("link not logged (dev sender must surface it for manual flow completion): %s", logged)
	}
}

// TestSenderInterface asserts the production contract: any provider used by
// services must satisfy Sender.
func TestSenderInterface(t *testing.T) {
	var _ Sender = NewDevSender(slog.Default())
}
