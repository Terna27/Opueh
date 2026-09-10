-- 000001_init: enable the citext extension.
--
-- citext provides a case-insensitive text type used from Milestone 3 onward
-- for the users.email column, so that "User@Example.com" and
-- "user@example.com" are the same address under a unique constraint without
-- needing lower() expression indexes everywhere.

CREATE EXTENSION IF NOT EXISTS citext;
