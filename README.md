<p align="center"><img src="assets/logo.svg" alt="FormBucket logo" width="96" height="96"></p>

<h1 align="center">FormBucket</h1>

<p align="center">
A self-hosted form backend that runs on Cloudflare Workers and D1.<br>
Point any form at it and collect the submissions, check them against a schema, see where visitors drop off,<br>
forward them to a webhook, or let your own apps pull only the entries they haven't seen yet.
</p>

<p align="center">
<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/momardia54/formbucket"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"></a>
</p>

![Analytics](assets/screenshots/analytics.jpg)

> **Status: pre-1.0 (0.3.1).** It works and is documented, but the public API may still change and we haven't tested every way of installing it yet. What is left before 1.0.0 is in the [Roadmap](website/src/content/docs/more/roadmap.md).

## Why FormBucket

You want a place to send form submissions without running a server, paying per submission or handing your visitors' data to a third party. FormBucket lives in your own Cloudflare account, fits in the free plan and needs no database setup: it creates and upgrades its own tables the first time it runs.

It also goes further than a mailbox for your forms. It tells you how many people saw a form and how many finished it, it lets your apps read new entries with a cursor that is stored on the server, and it has bot protection built in.

## Features

### One endpoint per form

Create a form in the dashboard and you get `POST /f/<form-id>`. It accepts a normal HTML form post, JSON, urlencoded or multipart bodies, so it works from a static site, `fetch`, cURL or another server. Any field name works and nothing has to be declared first.

```html
<form action="https://your-worker.workers.dev/f/contact" method="POST">
  <input name="email" type="email" required>
  <textarea name="message"></textarea>
  <button>Send</button>
</form>
```

### A schema when you want one

A new form accepts everything. When you're ready, describe your fields (type, required, min and max, pattern, choices, custom messages) and decide what happens to unknown fields. Nothing is rejected until you turn on **Enforce this schema**, and a built-in tester shows what would be rejected before you do. There is also a button that suggests fields from the submissions you already have.

![Field schema with opt-in enforcement](assets/screenshots/fields-enforce.jpg)

### Pull API with cursors

This is the part we like most. Your apps (n8n, a cron job, a reporting script) can ask "what is new since I last looked" without keeping track of anything themselves. Each named consumer has a cursor stored on the server.

```bash
# get the entries after this consumer's cursor
curl -H "Authorization: Bearer $KEY" \
  "https://your-worker.workers.dev/api/v1/forms/contact/consumers/n8n-crm/pull?limit=100"

# process them, then confirm up to the cursor you were given
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"cursor":"42"}' \
  "https://your-worker.workers.dev/api/v1/forms/contact/consumers/n8n-crm/ack"
```

- Pulling doesn't move the cursor. If your app crashes before it acknowledges, the next pull gives the same entries, so nothing gets lost. Use `?ack=true` to pull and acknowledge in one call when that is good enough.
- `?wait=25` holds the request open and answers as soon as a new submission arrives (long polling).
- You can move a cursor back to replay old entries: from the start, from the latest entry, from a specific number, or just the last N.
- Cursors keep working when submissions are deleted, so nothing is skipped or repeated.
- The dashboard shows every consumer with its unread count and last pull, and lets you replay, skip ahead or delete it.
- Keys can read data and manage cursors, but they can't change or delete submissions, forms or settings.

![Pull API consumers](assets/screenshots/api-consumers.jpg)

### Analytics without cookies

Add the tracking snippet and you get views, form starts, submissions and conversion, plus a funnel, the countries, sites and devices your visitors come from, and which fields get rejected and why. Click a field to see its fill rate and its most common values. There are no cookies and visitor IPs are never stored: only two daily-rotating salted hashes are, and the raw address is kept only for IPs you block, so you can undo it.

![Where visitors drop off and what gets rejected](assets/screenshots/analytics-breakdown.jpg)

Every card has a **View all** panel that you can search. Views from scripts and crawlers are ignored, and each visitor is counted once per 30 minutes, so the numbers stay close to real people.

### Signed webhooks

Send each submission to another service as JSON with an HMAC signature. Every delivery is logged, and failed ones are retried automatically up to six times with a growing delay, driven by a cron trigger. You can resend one by hand and send a test payload from the dashboard. Webhook addresses that point at private or loopback networks, or back at FormBucket itself, are refused.

![Webhook delivery log](assets/screenshots/webhook-deliveries.jpg)

### Bot protection and blocking

- A honeypot field that quietly accepts and discards what bots submit.
- **Cloudflare Turnstile**, set per form. A failed check returns `403`, and if your secret is wrong or Cloudflare is down the visitor isn't blamed.
- Per-visitor and per-form rate limits, an allowed origins list and an on/off switch for each form.
- **Automatic blocking:** block a visitor after a number of honeypot hits or failed Turnstile checks, for a few hours, days or forever.
- A **Blocked IPs** page where you can add IPv4, IPv6 or ranges by hand, search the list and unblock with one click. Blocked requests are refused without touching the database.

### The dashboard

A submissions table with a detail view, CSV and JSON export, light and dark themes, and a copy-paste **Integration** tab for each form. You sign in with a username and password that you set as Worker secrets, so there is no user table to manage.

![Submissions](assets/screenshots/submissions.jpg)

### Security and running it

Server-side sessions that are revoked on logout or password change, login throttling, a strict Content-Security-Policy and a request size cap. The database tables are created and upgraded by the Worker itself, so a deploy from the Cloudflare dashboard needs no commands. Details are in [Security](website/src/content/docs/more/security.md).

What FormBucket leaves out on purpose: sending email, file uploads and multiple users.

## Quick start

1. **Deploy:** click **Deploy to Cloudflare** above. It creates the Worker and a D1 database named `<worker-name>-db`. If you install more than one copy in an account, give each Worker a different name.
2. **Sign in:** open your Worker's address. Until you add the admin login as runtime secrets, the login page shows what is missing and how to add it.

   | Name | Type | Required |
   |---|---|---|
   | `ADMIN_USERNAME` | secret | yes |
   | `ADMIN_PASSWORD` | secret (12+ characters) | yes |
   | `SESSION_SECRET` | secret | recommended |
   | `DB_SUFFIX` | *build* variable | optional (custom database name) |

3. **Create a form and send data:**

   ```bash
   curl -X POST https://<your-worker>/f/contact \
     -H 'Content-Type: application/json' \
     -d '{"name":"Ada","email":"ada@example.com"}'
   ```

   Open **Submissions** in the dashboard and it is there.

## Documentation

The full documentation is in [`website/`](website), with one page per topic, built with Starlight. Start with the [Quickstart](website/src/content/docs/getting-started/quickstart.md).

| | |
|---|---|
| **Getting started** | [Quickstart](website/src/content/docs/getting-started/quickstart.md) · [Deploy](website/src/content/docs/getting-started/deploy.md) · [Configuration](website/src/content/docs/getting-started/configuration.md) · [Updating](website/src/content/docs/getting-started/updating.md) |
| **Guides** | [Sending data](website/src/content/docs/guides/sending-data.md) · [Schema](website/src/content/docs/guides/schema.md) · [Spam protection](website/src/content/docs/guides/spam-protection.md) · [Analytics](website/src/content/docs/guides/analytics.md) · [Webhooks](website/src/content/docs/guides/webhooks.md) · [Pull API](website/src/content/docs/guides/pull-api.md) · [Dashboard](website/src/content/docs/guides/dashboard.md) |
| **Reference** | [API endpoints](website/src/content/docs/reference/api-endpoints.md) · [Limits](website/src/content/docs/reference/limits.md) |
| **More** | [Security](website/src/content/docs/more/security.md) · [Architecture](website/src/content/docs/more/architecture.md) · [Troubleshooting](website/src/content/docs/more/troubleshooting.md) · [Development](website/src/content/docs/more/development.md) · [Roadmap to 1.0](website/src/content/docs/more/roadmap.md) |

What changed in each version: [CHANGELOG.md](CHANGELOG.md).

## Development

```bash
cp .dev.vars.example .dev.vars   # set ADMIN_USERNAME / ADMIN_PASSWORD
npm install
npm run dev                      # local D1 + Vite on :5173
npm test                         # unit tests
```

Running the docs site, editing pages and deploying it separately from the app: [Documentation site](website/src/content/docs/more/docs-site.md). Docs are part of every change: update the matching page (and the changelog) in the same commit.

## License

MIT. The dashboard UI kit is derived from [FormZero](https://github.com/BohdanPetryshyn/formzero) (MIT). See [LICENSE](LICENSE).
