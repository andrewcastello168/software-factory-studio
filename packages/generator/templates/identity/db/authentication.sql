CREATE TABLE factory_identity_users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT TRUE,
  administrator boolean NOT NULL DEFAULT FALSE
);

CREATE TABLE factory_identity_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES factory_identity_users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE INDEX factory_identity_sessions_expiry_idx ON factory_identity_sessions (expires_at);

CREATE TABLE factory_identity_attempts (
  bucket text PRIMARY KEY,
  attempts integer NOT NULL,
  resets_at timestamptz NOT NULL
);
