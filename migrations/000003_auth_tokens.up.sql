-- 000003_auth_tokens: session and token lifecycle tables.
--
-- sessions             : one row per login; the revocation unit and the
--                        refresh-token rotation family
-- refresh_tokens       : rotating tokens, stored hashed, single-use
-- email_verifications  : single-use, expiring verification tokens (hashed)
-- password_resets      : single-use, expiring reset tokens (hashed)
--
-- Only token hashes are ever stored. Plaintext tokens exist transiently in
-- application memory and in the single response that delivers them.

CREATE TABLE sessions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_agent   TEXT,
    ip_address   INET,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ,
    CONSTRAINT sessions_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
-- For the future cleanup worker (Milestone 30) that purges expired rows.
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ,
    CONSTRAINT refresh_tokens_token_hash_unique UNIQUE (token_hash),
    CONSTRAINT refresh_tokens_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX refresh_tokens_session_id_idx ON refresh_tokens(session_id);
CREATE INDEX refresh_tokens_expires_at_idx ON refresh_tokens(expires_at);

CREATE TABLE email_verifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    CONSTRAINT email_verifications_token_hash_unique UNIQUE (token_hash),
    CONSTRAINT email_verifications_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX email_verifications_user_id_idx ON email_verifications(user_id);
CREATE INDEX email_verifications_expires_at_idx ON email_verifications(expires_at);

CREATE TABLE password_resets (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ,
    requested_ip INET,
    CONSTRAINT password_resets_token_hash_unique UNIQUE (token_hash),
    CONSTRAINT password_resets_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX password_resets_user_id_idx ON password_resets(user_id);
CREATE INDEX password_resets_expires_at_idx ON password_resets(expires_at);
