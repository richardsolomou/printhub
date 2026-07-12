-- Rename the privileged application role without invalidating existing users
-- or outstanding invite links created by earlier releases.
UPDATE "user" SET role = 'admin' WHERE role = 'operator';

CREATE TABLE invites_admin_role (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'requester')),
  label TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by TEXT
);

INSERT INTO invites_admin_role (id, token_hash, role, label, created_at, expires_at, used_at, used_by)
SELECT id, token_hash, CASE role WHEN 'operator' THEN 'admin' ELSE role END, label, created_at, expires_at, used_at, used_by
FROM invites;

DROP TABLE invites;
ALTER TABLE invites_admin_role RENAME TO invites;
