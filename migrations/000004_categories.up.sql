-- 000004_categories: content categories and user interests.
--
-- categories      : platform-wide taxonomy (seeded below)
-- user_categories : M:N join; a user's interest selections

CREATE TABLE categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT categories_slug_unique UNIQUE (slug),
    CONSTRAINT categories_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- Seed the initial taxonomy. Idempotent on slug so re-running after a
-- partial down is safe.
INSERT INTO categories (slug, name, description) VALUES
    ('gaming',       'Gaming',       'Streams, clips and highlights from games'),
    ('music',        'Music',        'Performances, sessions and music discovery'),
    ('sports',       'Sports',       'Matches, analysis and athlete content'),
    ('education',    'Education',    'Courses, tutorials and explainers'),
    ('entertainment','Entertainment','Comedy, variety and general entertainment'),
    ('technology',   'Technology',   'Building, reviewing and discussing tech'),
    ('cooking',      'Cooking',      'Recipes, techniques and food culture'),
    ('fitness',      'Fitness',      'Training, health and wellness'),
    ('travel',       'Travel',       'Destinations, journeys and culture'),
    ('news',         'News',         'Current events and commentary')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE user_categories (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, category_id)
);

-- The composite PK serves user -> interests lookups; this index serves the
-- reverse direction (who is interested in a category).
CREATE INDEX user_categories_category_id_idx ON user_categories(category_id);
