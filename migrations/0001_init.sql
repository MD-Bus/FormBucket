-- FormBucket initial schema

CREATE TABLE forms (
    id TEXT PRIMARY KEY,                       -- url slug
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    fields TEXT NOT NULL DEFAULT '[]',         -- JSON array of field definitions
    unknown_fields TEXT NOT NULL DEFAULT 'reject' CHECK (unknown_fields IN ('reject', 'strip', 'keep')),
    allowed_origins TEXT NOT NULL DEFAULT '[]',-- JSON array; empty = any origin
    redirect_url TEXT,                         -- where HTML form posts are sent after success
    honeypot_field TEXT NOT NULL DEFAULT '_gotcha',
    rate_limit_per_min INTEGER NOT NULL DEFAULT 10, -- per visitor, 0 = unlimited
    webhook_enabled INTEGER NOT NULL DEFAULT 0,
    webhook_url TEXT,
    webhook_secret TEXT,
    webhook_headers TEXT NOT NULL DEFAULT '{}',-- JSON object of extra request headers
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX idx_forms_created_at ON forms(created_at);

-- seq is a monotonic cursor: it only ever grows, even after deletes.
CREATE TABLE submissions (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    data TEXT NOT NULL,                        -- JSON
    meta TEXT NOT NULL DEFAULT '{}',           -- JSON: country, device, referrer...
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_submissions_form_seq ON submissions(form_id, seq);
CREATE INDEX idx_submissions_form_created ON submissions(form_id, created_at);

-- Analytics events: view | start | submit | reject | spam | blocked
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('view', 'start', 'submit', 'reject', 'spam', 'blocked')),
    detail TEXT,                               -- JSON: validation errors or block reason
    country TEXT,
    referrer TEXT,                             -- host of the page the event came from
    device TEXT,
    visitor TEXT,                              -- salted daily hash, never a raw IP
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_events_form_time ON events(form_id, created_at);
CREATE INDEX idx_events_form_type_time ON events(form_id, type, created_at);
CREATE INDEX idx_events_visitor ON events(form_id, visitor, created_at);

CREATE TABLE webhook_deliveries (
    id TEXT PRIMARY KEY,
    form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    submission_id TEXT,
    event TEXT NOT NULL DEFAULT 'submission.created',
    url TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER,
    response_status INTEGER,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX idx_deliveries_form_created ON webhook_deliveries(form_id, created_at);
CREATE INDEX idx_deliveries_due ON webhook_deliveries(status, next_attempt_at);
CREATE INDEX idx_deliveries_submission ON webhook_deliveries(submission_id);

CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,                      -- first chars, for display only
    key_hash TEXT NOT NULL UNIQUE,             -- sha256 of the full key
    form_id TEXT REFERENCES forms(id) ON DELETE CASCADE, -- NULL = all forms
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
);

-- Named readers with a server-side cursor ("give me what's new since I last read").
CREATE TABLE consumers (
    form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    cursor INTEGER NOT NULL DEFAULT 0,         -- highest acknowledged submissions.seq
    created_at INTEGER NOT NULL,
    last_pull_at INTEGER,
    last_ack_at INTEGER,
    PRIMARY KEY (form_id, name)
);

CREATE TABLE login_attempts (
    ip_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts ON login_attempts(ip_hash, created_at);
