CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx ON users(username);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  area TEXT NOT NULL,
  city TEXT NOT NULL,
  transport_mode TEXT NOT NULL DEFAULT 'ebus' CHECK (transport_mode IN ('ebus', 'walk', 'auto')),
  refuel_preference TEXT NOT NULL DEFAULT 'tea_coffee' CHECK (refuel_preference IN ('tea_coffee', 'high_protein_veg_snacks', 'cool_drinks')),
  vibe TEXT NOT NULL DEFAULT 'nature' CHECK (vibe IN ('nature', 'urban', 'quiet')),
  place_preferences JSONB NOT NULL DEFAULT '["parks","cafes"]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_break_state (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  local_date DATE NOT NULL,
  next_threshold_seconds INTEGER NOT NULL DEFAULT 10800 CHECK (next_threshold_seconds >= 0),
  skipped_first BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE user_break_state ALTER COLUMN next_threshold_seconds SET DEFAULT 10800;
UPDATE user_break_state SET next_threshold_seconds = 10800 WHERE next_threshold_seconds = 10;

CREATE TABLE IF NOT EXISTS user_screen_time_daily (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date DATE NOT NULL,
  active_seconds INTEGER NOT NULL DEFAULT 0 CHECK (active_seconds >= 0 AND active_seconds <= 86400),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, local_date)
);

CREATE TABLE IF NOT EXISTS missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mission_type TEXT NOT NULL,
  message TEXT NOT NULL,
  badge_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'completed', 'skipped')),
  place_id TEXT,
  itinerary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS missions_user_created_idx ON missions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS place_visits (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  place_name TEXT NOT NULL,
  city TEXT NOT NULL,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS place_visits_user_recent_idx ON place_visits(user_id, visited_at DESC);

CREATE TABLE IF NOT EXISTS place_recommendations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  place_name TEXT NOT NULL,
  city TEXT NOT NULL,
  recommended_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS place_recommendations_user_recent_idx ON place_recommendations(user_id, recommended_at DESC);

CREATE TABLE IF NOT EXISTS scrapbook_badges (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id TEXT NOT NULL,
  title TEXT NOT NULL,
  condition TEXT NOT NULL,
  pixel TEXT NOT NULL,
  tone TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS community_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mission_id UUID REFERENCES missions(id) ON DELETE SET NULL,
  city TEXT NOT NULL,
  mission TEXT NOT NULL,
  badge_id TEXT NOT NULL,
  photo_label TEXT NOT NULL,
  photo_emoji TEXT NOT NULL DEFAULT '🌿',
  photo_tone TEXT NOT NULL DEFAULT 'earth' CHECK (photo_tone IN ('leaf', 'sunset', 'sky', 'earth')),
  caption TEXT NOT NULL DEFAULT '',
  photo_data BYTEA,
  photo_mime TEXT CHECK (photo_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS caption TEXT NOT NULL DEFAULT '';
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS photo_data BYTEA;
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS photo_mime TEXT;
CREATE INDEX IF NOT EXISTS community_posts_created_idx ON community_posts(created_at DESC);

CREATE TABLE IF NOT EXISTS post_reactions (
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL CHECK (reaction IN ('sprouted', 'touched_grass')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id, reaction)
);
