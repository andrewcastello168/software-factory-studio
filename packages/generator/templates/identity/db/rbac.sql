CREATE TABLE factory_identity_roles (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE factory_identity_role_permissions (
  role_id uuid NOT NULL REFERENCES factory_identity_roles (id) ON DELETE CASCADE,
  permission text NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE factory_identity_user_roles (
  user_id uuid NOT NULL REFERENCES factory_identity_users (id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES factory_identity_roles (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
