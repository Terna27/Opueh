-- 000002_users: core identity tables.
--
-- users          : credentials, role, status, soft-delete
-- user_profiles  : 1:1 public profile data
--
-- citext is used for email and username: display case is preserved, but
-- uniqueness and lookups are case-insensitive.

-- Shared trigger: keeps updated_at honest regardless of application code.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE users (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email             CITEXT NOT NULL,
    username          CITEXT NOT NULL,
    password_hash     TEXT   NOT NULL,
    role              TEXT   NOT NULL DEFAULT 'USER'
                      CONSTRAINT users_role_check
                      CHECK (role IN ('USER', 'CREATOR', 'MODERATOR', 'ADMIN')),
    status            TEXT   NOT NULL DEFAULT 'ACTIVE'
                      CONSTRAINT users_status_check
                      CHECK (status IN ('ACTIVE', 'SUSPENDED', 'BANNED')),
    email_verified_at TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,
    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT users_username_unique UNIQUE (username)
);

CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_profiles (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    bio         TEXT CONSTRAINT user_profiles_bio_length CHECK (char_length(bio) <= 500),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER user_profiles_set_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
