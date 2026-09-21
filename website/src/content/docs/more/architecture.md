---
title: Architecture
description: Request flow, database tables, migrations and how the dashboard stays fast.
sidebar:
  order: 2
---

```
                    ┌──────────────────────────── Cloudflare Worker ────────────────────────────┐
 HTML form / fetch ─►  /f/:id            block check → limits → validate → D1 → webhook         │
 tracking snippet  ─►  /f/:id/view|start  filters → D1 events                                   │
 apps / n8n        ─►  /api/v1/*          key auth → cursors / consumers in D1                  │
 you (browser)     ─►  everything else    React Router SSR dashboard (server-side session)      │
                    │  cron (every minute)  retry due webhooks · hourly prune                   │
                    └───────────────────────────────────┬────────────────────────────────────────┘
                                                        ▼
                                                   D1 database
```

Stack: React Router 7 (SSR), Tailwind 4, shadcn/ui, Recharts, TypeScript.

## What happens to a submission

In order, stopping at the first refusal:

1. **Blocked address?** `403`, decided from an in-memory list, with no database access at all.
2. **Form found?** Read from a 10-second in-memory cache (`404` if it does not exist).
3. **Limits.** One query counts recent activity for both the per-visitor limit and the form-wide limit (`429`, nothing written).
4. **Form on? Origin allowed?** `403`, recorded as *blocked* in analytics.
5. **Body read** with a hard 1 MB cap, whatever the content type (`413`).
6. **Honeypot filled?** Pretend it worked, store nothing, count towards [automatic blocking](/guides/spam-protection/#automatic-blocking).
7. **Turnstile** (when enabled for the form): failed check `403` and counted towards blocking; our misconfiguration or a Cloudflare outage `503`, never counted against the visitor.
8. **Schema** (when enforced): `422` with per-field errors, or the cleaned data continues.
9. **Stored** together with its analytics event in one batch, then the webhook is delivered in the background and retried by the cron.

## Database tables

| Table | Purpose |
|---|---|
| `forms` | One row per form: schema, settings, webhook, Turnstile keys, blocking rules. |
| `submissions` | The data. `seq` is an autoincrement counter and is the pull-API cursor. |
| `events` | Analytics events (view, start, submit, reject, spam, blocked) with daily-rotating hashes, never raw IPs. |
| `webhook_deliveries` | Delivery log and retry queue. |
| `api_keys`, `consumers` | Pull API keys (hashed) and named readers with their cursor. |
| `sessions` | Server-side dashboard sessions (hashed token). |
| `ip_blocks` | Blocked addresses and ranges: the only place real IPs are stored. |
| `login_attempts` | Failed-login throttling. |
| `d1_migrations` | Which migrations have run (shared with Wrangler). |

## Migrations

The SQL lives in `migrations/` and is **bundled into the Worker**, which applies anything missing on the first request after a deploy (using the same `d1_migrations` table as `wrangler d1 migrations apply`, so both ways stay compatible). Deploys made from the Cloudflare dashboard never run commands, so this is what keeps their database current. Migrations only add to the schema.

| File | Adds |
|---|---|
| `0001_init.sql` | Forms, submissions, events, webhook deliveries, API keys, consumers, login attempts. |
| `0002_schema_enforced.sql` | The *Enforce this schema* switch (existing forms that had a schema keep enforcing). |
| `0003_security_hardening.sql` | Server-side sessions, the form-wide limit, IP-only hash column on events. |
| `0004_blocking_and_turnstile.sql` | Turnstile settings, automatic-blocking rules, the `ip_blocks` table. |

## How the dashboard stays fast

Every database query is a network hop to D1 (about 25 to 30 ms each), so the goal is fewer, not faster, queries:

- **Batching.** Analytics, submissions and field insights send all their queries in a single D1 batch, one round trip instead of up to 17.
- **Request-scoped reuse.** A page is several nested loaders that all need the session and the form. Those two lookups run once per request and are shared (`app/server/request-cache.server.ts`). Anything an action may have just changed is only shared on read-only requests.
- **Selective revalidation.** React Router re-runs every parent loader on each click unless told otherwise. The sidebar and form layouts opt out, so a click loads only its own page, and a save no longer reloads the sidebar.
- **Prefetch and feedback.** Hovering a sidebar link loads the page early; a progress bar and pending link styling show that something is happening.
- **Short in-memory caches on the public path:** form settings and the active block list, both 10 seconds (so a settings change or block can take up to that long to reach every running instance).

Measured on a real deployment, an analytics click went from 17 queries and about 130 ms of server time to 5 queries and about 85 ms.
