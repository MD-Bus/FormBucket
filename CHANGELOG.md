# Changelog

All notable changes to FormBucket. Newest first. Each version lists what was added, what changed, what was fixed and how to upgrade. The full behaviour of every feature is documented in the [documentation](website/src/content/docs/getting-started/quickstart.md).

## 0.3.0

### Added
- **Cloudflare Turnstile** (optional, per form). Site key and secret in *Settings → Bot protection*; the Integration tab shows the widget snippet. Failed checks return `403`; a wrong secret or a Cloudflare outage returns `503` and is never counted against the visitor. See [Cloudflare Turnstile](website/src/content/docs/guides/spam-protection.md#cloudflare-turnstile-optional-per-form).
- **Automatic blocking** (per form): block a visitor after N honeypot hits or failed Turnstile checks within an hour, for hours, days or permanently. IPv4 exact address, IPv6 whole `/64`. See [Automatic blocking](website/src/content/docs/guides/spam-protection.md#automatic-blocking).
- **Blocked IPs page**: block IPv4, IPv6 or CIDR ranges manually, list and search every active block with its reason, unblock with one click. Ranges broader than `/16` (IPv4) or `/32` (IPv6) and ranges containing your own address are refused. Blocked requests are refused before any database access. See [Blocked IPs](website/src/content/docs/guides/spam-protection.md#blocked-ips).
- **Cursor reset with `back`**: `POST …/consumers/:name/reset` accepts `{ "back": N }` to replay the last N entries of a form (correct even though cursor numbers are shared by all forms and have gaps). See [Moving a cursor](website/src/content/docs/guides/pull-api.md#moving-a-cursor).
- **View spam protection.** Views and starts are ignored when the request has no `Origin`/`Referer`, comes from a script or crawler user agent, or the IP was already counted in the last 30 minutes (changing the `User-Agent` no longer creates a second view). Analytics warns when a flood made views drop (over 300 per minute) and when *Allowed origins* is empty. Recipe for counting only new visitors with your own cookie. See [How views are counted](website/src/content/docs/guides/analytics.md#how-views-are-counted).
- **View all panels** on the Analytics cards (countries, sites, devices, rejected fields): searchable, loaded 50 at a time. Field insights can show up to 50 top values.
- **Setup screen.** When `ADMIN_USERNAME` / `ADMIN_PASSWORD` are not set, the login page explains what is missing and shows both ways to add them (dashboard steps, and `wrangler secret put` commands filled in with the real Worker name). Deploying without them never fails.
- **Automatic database migrations.** The migrations are bundled into the Worker and applied on the first request after a deploy, so installs made from the Cloudflare dashboard need no commands. Shares `d1_migrations` with Wrangler.
- **Optional `DB_SUFFIX` build variable**: names the database `<worker-name>-<suffix>` (for example `formbucket-x7k2`). See [Databases and multiple installs](website/src/content/docs/getting-started/configuration.md#databases-and-multiple-installs).
- **Loading feedback**: a progress bar, pending styling on sidebar links, prefetch on hover.
- **Documentation website** (`website/`, built with Astro Starlight): the README split into one page per topic with a sidebar built from the folders, full-text search, dark mode and a build that fails on broken internal links. New pages: Quickstart and Documentation site. It is a separate Cloudflare Worker (`formbucket-docs`) from the app, deployed independently; see `website/README.md`.
- Documentation in the README: Architecture (request flow, tables, migrations, performance), a table of every dashboard page, and this changelog.

### Changed
- **The database is no longer named with a fixed name.** `wrangler.jsonc` has no `database_name`, so Wrangler creates `<worker-name>-db`. A fixed name made every install silently reuse any existing database with that name. Existing installs keep their current database.
- **The deploy script is now `build` + `wrangler deploy`.** It no longer migrates before deploying (a first deploy has no database yet); the Worker migrates itself.
- **Faster dashboard.** Analytics, submissions and field insights send their queries as one D1 batch (analytics 17 → 5 queries). The session and form are looked up once per request. Sidebar and form layouts no longer reload on every click or save. Measured on a real deployment: analytics server time about 132 → 85 ms.
- The public endpoint keeps a form's settings and the active block list in memory for 10 seconds. A settings change or block can take up to that long to reach every running instance.
- One database read instead of two for the per-visitor and form-wide limits.
- `reset` refuses a cursor higher than the latest entry (`400`). Before, it silently skipped every submission that arrived before the counter caught up.
- API key wording: keys can read submissions **and manage consumer cursors** (acknowledge, reset, delete); they cannot change or delete submissions, forms or settings. Earlier documentation called them "read-only".
- The "infer fields" button is now *Add fields found in submissions* with a neutral icon and an explanation (it is pattern matching, not AI).

### Fixed
- A Turnstile wrong-secret response (HTTP 400 from Cloudflare) was reported as "unavailable" instead of "misconfigured".
- Site names in Analytics were capitalised (`Acme.Dev`).

### Upgrading from 0.2
- Deploy as usual. Migration `0004_blocking_and_turnstile.sql` is applied automatically on the first request.
- Turnstile is off and automatic blocking is off (0 attempts) by default, so nothing changes until you enable them.
- The database name only matters for new installs; an existing Worker keeps its bound database.
- If you set *Allowed origins*, beacons from other sites were already ignored; now beacons without `Origin`/`Referer` and from script user agents are ignored too, so view counts may drop to the real number.

## 0.2.0

### Added
- **Opt-in schema enforcement.** A form with fields accepts everything until you switch on *Enforce this schema*; the tester shows what would be rejected. Migration `0002` keeps enforcement on for forms that already had a schema.
- **Server-side sessions.** The login cookie is a random token; only its hash is stored. Logging out revokes it, and changing `ADMIN_PASSWORD` invalidates every session.
- **Security headers and a nonce-based Content-Security-Policy** on the dashboard, `no-store` caching, HSTS on HTTPS.
- **Form-wide limit** (default 120 events per minute): once reached, further requests get `429` and nothing more is written. Per-visitor limits now use an IP-only hash.
- Global login slowdown when many failures pile up across IPs, and a dashboard warning while the admin password is shorter than 12 characters.
- Security regression tests for every fix below.
- MIT license declared in `package.json`.
- README rewritten as the full documentation, with screenshots.

### Changed
- The 1 MB request-size limit is enforced while reading the body, for every content type (chunked bodies used to bypass it).
- The User-Agent is no longer stored with submissions (only the derived device class).
- Webhook URL validation also refuses IPv6-mapped loopback addresses, DNS names that resolve to loopback (`localtest.me`, `nip.io`, …) and this FormBucket itself.
- Keys such as `__proto__` are dropped and names such as `constructor` are stored like any other field.

### Fixed
- The webhook page nested a form inside another form (invalid HTML, hydration error).
- Deleting a submission turned the whole page into a 404.
- API key revocation used a native browser `confirm()`; it is now an in-app dialog.
- Conversion and funnel percentages above 100% are capped; chart animation no longer stalls in background tabs.

### Upgrading from 0.1
- You will be signed out once (sessions moved from signed cookies to server-side sessions).
- Run or let the Worker apply migrations `0002` and `0003`.

## 0.1.0

First release.

### Added
- **Form buckets**: one endpoint per form (`POST /f/:formId`, also `/api/forms/:id/submissions`) accepting HTML form posts, urlencoded, multipart and JSON.
- **Field schema** with types, required, min/max, patterns, choices, custom messages, and rules for unknown fields; a validation tester and field inference.
- **Analytics**: views, starts, submissions, conversion, rejections by field and reason, countries, sites, devices, per-field insights, and an optional tracking snippet. No cookies, no stored IPs.
- **Webhooks**: HMAC-signed JSON, custom headers, delivery log, manual resend, six attempts with backoff driven by a cron trigger.
- **Pull API**: API keys, named consumers with server-side cursors, acknowledge, long polling, stateless listing.
- **Spam control**: honeypot, origin allowlist, per-visitor rate limit, on/off switch.
- **Dashboard** using the FormZero UI kit (MIT): submissions table with detail panel, CSV/JSON export, dark and light themes; login from Worker secrets.
- Deploy to Cloudflare button, MIT license.
