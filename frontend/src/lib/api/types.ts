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
 *   internal/handlers/user.go     — User, AuthResponse
 *   internal/handlers/auth.go     — register/login/refresh request bodies
 *   internal/handlers/profile.go  — MyProfile, PublicProfile, ProfilePatchRequest
 *   internal/handlers/category.go — Category, and the two list envelopes
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

/* ------------------------------------------------------------------ *
 * Categories and interests
 * ------------------------------------------------------------------ */

/**
 * `categoryResponse` in internal/handlers/category.go.
 *
 * `created_at` is deliberately absent: the backend keeps administrative
 * metadata off the wire, so there is nothing here to mirror.
 */
export type Category = {
  id: string;
  name: string;
  slug: string;
  /** Nullable — the column is, and the seeded rows may leave it unset. */
  description: string | null;
};

/**
 * `GET /api/v1/categories` — the full selectable taxonomy.
 *
 * `newCategoryResponses` allocates with `make([]T, 0, n)`, so an empty list
 * arrives as `[]` and never as `null`. The distinction is kept in the type
 * because treating a missing key as an empty list would silently render "no
 * categories" for a malformed response.
 */
export type CategoryList = {
  categories: Category[];
};

/** `GET|PUT /api/v1/me/interests`. The same element type, a different key. */
export type InterestList = {
  interests: Category[];
};

/** `replaceInterestsRequest` in internal/handlers/category.go. */
export type ReplaceInterestsRequest = {
  /**
   * The complete set, not a delta — PUT replaces what was there. The service
   * rejects duplicates rather than collapsing them, so this is sent as the
   * picker holds it, with no de-duplication on the way out.
   */
  category_ids: string[];
};

/* ------------------------------------------------------------------ *
 * Profiles
 * ------------------------------------------------------------------ */

/**
 * `myProfileResponse` in internal/handlers/profile.go.
 *
 * Deliberately NOT `User` with extra fields. The two come from different
 * handlers and overlap by accident, not by contract: this one omits `status`
 * and adds `bio`/`updated_at`. Deriving one from the other would make a
 * backend change to either silently alter the other's type.
 */
export type MyProfile = {
  id: string;
  username: string;
  display_name: string;
  /** Nullable: no bio yet, or it was cleared. */
  bio: string | null;
  email: string;
  role: UserRole;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * `publicProfileResponse` in internal/handlers/profile.go.
 *
 * A strictly smaller shape than `MyProfile`, and the difference is the point:
 * no `email`, no `role`, no `email_verified`. Anyone can read this one, and
 * the type says so — a component that wanted the email here would not compile.
 */
export type PublicProfile = {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  created_at: string;
};

/**
 * `profilePatchRequest` in internal/handlers/profile.go.
 *
 * Both fields are pointers upstream, which is what makes "absent" and "empty"
 * different requests: a missing `bio` leaves it alone, while `bio: ""` clears
 * it. So both are optional here, and a caller omits a field the user did not
 * touch rather than sending an empty string for it.
 */
export type ProfilePatchRequest = {
  display_name?: string;
  bio?: string;
};
