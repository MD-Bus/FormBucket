-- Per-form Cloudflare Turnstile and automatic blocking policies.
ALTER TABLE forms ADD COLUMN turnstile_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forms ADD COLUMN turnstile_site_key TEXT;
ALTER TABLE forms ADD COLUMN turnstile_secret TEXT;
-- Block a visitor after N honeypot hits / failed Turnstile checks within an hour. 0 = off. Hours 0 = permanent.
ALTER TABLE forms ADD COLUMN honeypot_block_after INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forms ADD COLUMN honeypot_block_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE forms ADD COLUMN turnstile_block_after INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forms ADD COLUMN turnstile_block_hours INTEGER NOT NULL DEFAULT 24;

-- Addresses refused by the public endpoints. This is the only place a real IP address is stored: an admin
-- has to be able to see and undo a block. Rows disappear when they expire or are removed.
CREATE TABLE ip_blocks (
    id TEXT PRIMARY KEY,
    cidr TEXT NOT NULL UNIQUE,         -- canonical "1.2.3.4/32", "1.2.3.0/24", "2001:db8::/64"
    reason TEXT NOT NULL CHECK (reason IN ('manual', 'honeypot', 'turnstile')),
    form_id TEXT,                      -- which form triggered an automatic block (informational)
    note TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER                 -- NULL = permanent
);
CREATE INDEX idx_ip_blocks_expires ON ip_blocks(expires_at);
