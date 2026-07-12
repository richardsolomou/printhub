-- Single-use invite links: the operator hands one to a person (a paying
-- customer, a teammate) who then creates their own account through it.
-- Sign-up stays closed to everyone else. Only the token hash is stored.
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('operator', 'requester')),
  label TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by TEXT
);
