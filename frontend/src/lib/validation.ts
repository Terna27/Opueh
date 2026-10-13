/**
 * Client-side field validation.
 *
 * These rules MIRROR the Go backend exactly — see internal/handlers/validate.go
 * and internal/services/auth.go. They exist here because the backend returns a
 * single `VALIDATION_ERROR` message with no per-field information, so a useful
 * form has to check fields itself before submitting.
 *
 * They are a UX affordance, never a guarantee: the backend re-validates
 * everything it receives, and its verdict is the one that counts.
 *
 * Do not add rules the backend does not enforce. A rule invented here would
 * reject input the API would have accepted.
 */

/** Mirrors `usernameRegex` in internal/handlers/validate.go. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,30}$/;

/** Mirrors `emailRegex` in internal/handlers/validate.go. */
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Mirrors validateRegistration in internal/handlers/validate.go. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const DISPLAY_NAME_MAX_LENGTH = 50;
export const EMAIL_MAX_LENGTH = 254;

/** Mirrors `MaxBioLength` in internal/services/profile.go. */
export const BIO_MAX_LENGTH = 500;

/** Mirrors `MinInterests` and `MaxInterests` in internal/services/category.go. */
export const MIN_INTERESTS = 1;
export const MAX_INTERESTS = 10;

/*
 * One known divergence from the backend, recorded rather than papered over.
 *
 * Go measures `len(password)` in BYTES; JavaScript measures `.length` in
 * UTF-16 code units. For ASCII they agree. For a password containing emoji or
 * non-Latin script they do not: 40 emoji are 80 code units here and 160 bytes
 * in Go, so a password this module accepts can still be rejected upstream.
 *
 * The divergence is left in place deliberately. The failure is safe and
 * legible — the user sees the backend's "password must be at most 128
 * characters" and picks a different password — whereas measuring bytes here
 * would make the message wrong for the same user ("at most 128 characters" for
 * a 40-character password) and would reject input the field is labelled to
 * accept. The backend's verdict is the one that counts.
 */

/**
 * A validation message, or undefined when the value is acceptable.
 *
 * The wording is adapted for display beneath a labelled field, where "Email
 * must be 254 characters or fewer" reads better than the backend's
 * "email must be at most 254 characters". The RULES are identical; only the
 * presentation differs.
 */
export type ValidationMessage = string | undefined;

export function validateEmail(value: string): ValidationMessage {
  const email = value.trim();

  if (email === "") {
    return "Email is required.";
  }
  if (email.length > EMAIL_MAX_LENGTH) {
    return `Email must be ${EMAIL_MAX_LENGTH} characters or fewer.`;
  }
  if (!EMAIL_PATTERN.test(email)) {
    return "Enter a valid email address.";
  }
  return undefined;
}

export function validateUsername(value: string): ValidationMessage {
  const username = value.trim();

  if (username === "") {
    return "Username is required.";
  }
  if (!USERNAME_PATTERN.test(username)) {
    return "Username must be 3-30 characters, using only letters, digits and underscores.";
  }
  return undefined;
}

export function validatePassword(value: string): ValidationMessage {
  if (value === "") {
    return "Password is required.";
  }
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`;
  }
  return undefined;
}

/**
 * Display name is optional — the backend falls back to the username when it
 * is empty — so an empty value is valid here.
 *
 * This is the REGISTRATION rule. Editing a profile is stricter; see
 * `validateProfileDisplayName`.
 */
export function validateDisplayName(value: string): ValidationMessage {
  if (value.trim().length > DISPLAY_NAME_MAX_LENGTH) {
    return `Display name must be ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`;
  }
  return undefined;
}

/**
 * The display name rule for editing a profile, which is NOT the registration
 * one, and the difference is the backend's.
 *
 * `buildProfilePatch` in internal/services/profile.go rejects a supplied
 * `display_name` that is empty after trimming — "display_name cannot be empty
 * when supplied" — because a PATCH of that field is an instruction to set it,
 * and there is no username fallback on that path. Registration treats an empty
 * display name as "use the username"; an edit cannot.
 *
 * The wording differs from the backend's too: this is shown beneath a labelled
 * field, where "Display name is required." reads better than the backend's
 * identifier-flavoured "display_name cannot be empty when supplied". The rule
 * is identical; only the presentation differs.
 */
export function validateProfileDisplayName(value: string): ValidationMessage {
  if (value.trim() === "") {
    return "Display name is required.";
  }
  return validateDisplayName(value);
}

/**
 * Bio is optional, and an empty one is meaningful rather than merely allowed:
 * supplying an empty bio is how a user CLEARS it. So an empty value is valid
 * here, and the form sends it as an empty string rather than omitting the
 * field.
 *
 * Like the backend, the limit is measured after trimming — `buildProfilePatch`
 * trims before comparing, so measuring the untrimmed value here would reject
 * input the API would have accepted.
 */
export function validateBio(value: string): ValidationMessage {
  if (value.trim().length > BIO_MAX_LENGTH) {
    return `Bio must be ${BIO_MAX_LENGTH} characters or fewer.`;
  }
  return undefined;
}

/**
 * Whether a selection is a valid number of interests.
 *
 * The messages are the backend's own sentences, not the display-adapted
 * phrasing the rest of this module uses. Every other rule here is rewritten
 * for a labelled field; these two are left verbatim on purpose, because the
 * selection count is the one rule a user is most likely to hit by accident and
 * hearing the API's exact words — in the UI and in a direct call — makes it
 * obvious they are the same rule.
 *
 * Note that `MaxInterests` is the count of the selection, not of the
 * catalogue: with ten categories seeded, "at most 10" is satisfiable, so the
 * upper bound is a rule the UI must still enforce rather than one it can never
 * reach.
 */
export function validateInterestCount(count: number): ValidationMessage {
  if (count < MIN_INTERESTS) {
    return `at least ${MIN_INTERESTS} category must be supplied`;
  }
  if (count > MAX_INTERESTS) {
    return `at most ${MAX_INTERESTS} categories may be selected`;
  }
  return undefined;
}
