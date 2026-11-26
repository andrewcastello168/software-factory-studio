CREATE TABLE factory_identity_audit (
  id uuid PRIMARY KEY,
  actor_id uuid,
  action text NOT NULL,
  target_id uuid,
  resource text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX factory_identity_audit_time_idx ON factory_identity_audit (occurred_at);
