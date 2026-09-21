-- Form-wide cap on public writes per minute (backstop against floods that rotate identities). 0 = unlimited.
ALTER TABLE forms ADD COLUMN global_limit_per_min INTEGER NOT NULL DEFAULT 120;

-- IP-only salted hash used for rate limiting and de-duplication, so changing the User-Agent does not help an attacker.
ALTER TABLE events ADD COLUMN ip_hash TEXT;
CREATE INDEX idx_events_ip ON events(form_id, ip_hash, created_at);

-- Server-side sessions: the cookie holds an opaque random token, only its hash is stored here.
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,               -- sha256 of the cookie token
    cred TEXT NOT NULL,                -- fingerprint of the admin credentials; a password change invalidates the session
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
