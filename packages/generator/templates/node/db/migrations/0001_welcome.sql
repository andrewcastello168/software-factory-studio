CREATE TABLE welcome_messages (
  variant text PRIMARY KEY,
  message text NOT NULL CHECK (length(message) > 0)
);

INSERT INTO welcome_messages (variant, message) VALUES
  ('default', 'Welcome from PostgreSQL.'),
  ('short', 'Ready.');
