/**
 * TypeScript mirrors of the Go API's JSON contract.
 *
 * This module is deliberately isomorphic — it is imported by both the server
 * proxy layer and client components, and it emits no runtime code at all.
 * The server-only boundary lives in `./server-only`, applied to the modules
 * that actually handle tokens.
 *
 * Field names are copied from the Go struct tags verbatim — `display_name`,
 * `email_verified`, `access_token` — because they are what actually travels
 * over the wire. Renaming one to camelCase here would silently produce
 * `undefined` on the client, and the Go decoder rejects unknown fields
 * outright, so the two must agree exactly in both directions.
 *
 * Sources:
 *   internal/handlers/user.go   — User, AuthResponse
 *   internal/handlers/auth.go   — register/login/refresh request bodies
 *   migrations/000002_users.up.sql — the role and status vocabularies
 */

/** CHECK (role IN (...)) in migrations/000002_users.up.sql. */
export type UserRole = "USER" | "CREATOR" | "MODERATOR" | "ADMIN";

/** CHECK (status IN (...)) in migrations/000002_users.up.sql. */
export type UserStatus = "ACTIVE" | "SUSPENDED" | "BANNED";

/** `userResponse` in internal/handlers/user.go. */
export type User = {
  id: string;
  username: string;
  /** The backend falls back to the username when none was supplied. */
  display_name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  email_verified: boolean;
  /** RFC 3339, from Go's encoding of time.Time. */
  created_at: string;
};

/**
 * `authResponse` in internal/handlers/user.go — the payload of register,
 * login and refresh.
 *
 * This type is confined to the server. The proxy handlers consume it and
 * return only `{ user }` to the browser, so the token fields never cross into
 * client code.
 */
export type AuthResponse = {
  user: User;
  access_token: string;
  /** Always "Bearer"; the backend hardcodes it. */
  token_type: string;
  /** Access token lifetime in SECONDS — not milliseconds. */
  expires_in: number;
  refresh_token: string;
};

/** `registerRequest` in internal/handlers/auth.go. */
export type RegisterRequest = {
  email: string;
  username: string;
  password: string;
  /** Optional; the backend substitutes the username when empty. */
  display_name: string;
};

/** `loginRequest` in internal/handlers/auth.go. Email OR username. */
export type LoginRequest = {
  identifier: string;
  password: string;
};

/**
 * What the browser receives from the proxy routes.
 *
 * The absence of tokens here is the point of the whole design: this is the
 * only auth-shaped payload that ever reaches client code.
 */
export type SessionUser = {
  user: User;
};
