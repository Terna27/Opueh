package handlers

import (
	"time"

	"github.com/Tena-byte/opueh/internal/models"
	"github.com/Tena-byte/opueh/internal/services"
)

// userResponse is the public representation of a user account. It never
// includes the password hash or soft-delete metadata.
type userResponse struct {
	ID            string    `json:"id"`
	Username      string    `json:"username"`
	DisplayName   string    `json:"display_name"`
	Email         string    `json:"email"`
	Role          string    `json:"role"`
	Status        string    `json:"status"`
	EmailVerified bool      `json:"email_verified"`
	CreatedAt     time.Time `json:"created_at"`
}

func newUserResponse(u *models.User) userResponse {
	return userResponse{
		ID:            u.ID.String(),
		Username:      u.Username,
		DisplayName:   u.DisplayName,
		Email:         u.Email,
		Role:          u.Role,
		Status:        u.Status,
		EmailVerified: u.EmailVerifiedAt != nil,
		CreatedAt:     u.CreatedAt,
	}
}

// authResponse is the payload of register/login/refresh.
type authResponse struct {
	User         userResponse `json:"user"`
	AccessToken  string       `json:"access_token"`
	TokenType    string       `json:"token_type"`
	ExpiresIn    int64        `json:"expires_in"`
	RefreshToken string       `json:"refresh_token"`
}

func newAuthResponse(result *services.AuthResult) authResponse {
	return authResponse{
		User:         newUserResponse(result.User),
		AccessToken:  result.AccessToken,
		TokenType:    result.TokenType,
		ExpiresIn:    result.ExpiresIn,
		RefreshToken: result.RefreshToken,
	}
}
