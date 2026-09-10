// Package email abstracts outbound email delivery behind the Sender
// interface. Services compose Message values and hand them to a Sender; they
// never know which provider delivered them, so swapping the development
// sender for a real provider (SES, Postmark, SMTP, ...) is a wiring change in
// cmd/api only — no service logic changes.
package email

import (
	"context"
	"log/slog"
)

// Message is a single outbound email. Body is plain text for now; HTML
// templating can be added later without changing the interface.
type Message struct {
	To      string
	Subject string
	Body    string
}

// Sender delivers messages. Implementations must be safe for concurrent use.
type Sender interface {
	Send(ctx context.Context, msg Message) error
}

// DevSender is the development/local email sender: it logs the full message
// (including any links it contains) at INFO level instead of delivering it.
// It exists so developers and tests can complete verification/reset flows
// without a paid provider.
//
// SECURITY: DevSender intentionally surfaces links that embed secret tokens.
// Config validation only allows it in local and staging (team-controlled
// environments); production must configure a real provider — the process
// refuses to start otherwise, so email is never silently swallowed.
type DevSender struct {
	logger *slog.Logger
}

// NewDevSender constructs the development sender.
func NewDevSender(logger *slog.Logger) *DevSender {
	return &DevSender{logger: logger}
}

// Send logs the message. It never fails: delivery problems cannot block a
// local development flow.
func (d *DevSender) Send(ctx context.Context, msg Message) error {
	d.logger.InfoContext(ctx, "dev_email_delivered",
		"to", msg.To,
		"subject", msg.Subject,
		"body", msg.Body,
	)
	return nil
}
