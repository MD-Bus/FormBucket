---
title: Troubleshooting
description: Symptoms and fixes.
sidebar:
  order: 3
---

| Symptom | Fix |
|---|---|
| Login page shows *One last step* | `ADMIN_USERNAME` and/or `ADMIN_PASSWORD` are not set on the deployed Worker. Add them as described in [Configuration](/getting-started/configuration/), then press *check again*. |
| `no such table` / `no such column` errors, or a 500 right after logging in | The database is older than the code. Current versions upgrade it automatically on the first request: deploy the latest version and reload. If the *Database upgrade failed* page appears, run `npx wrangler d1 migrations apply <worker-name>-db --remote` once. |
| Browser shows a CORS error | Check *Allowed origins* in the form's settings; the request must come from a listed site. Read the response of the failing request for `403`. |
| `403` from `curl` on a form with allowed origins | Server calls carry no `Origin` header. Clear the allowlist or send a matching `Origin` header. |
| `403` "Submissions from your address are blocked" | The address is on the Blocked IPs list (manually or by an automatic rule). Unblock it there. Changes reach every instance within about 10 seconds. |
| Every submission is rejected with "Verification failed" | *Require Turnstile* is on but the form page does not include the widget, or it uses a different site key. Add the snippet from the Integration tab, or switch Turnstile off. |
| `503` "Verification is temporarily unavailable" | The Turnstile secret key in Settings is wrong (Analytics shows `turnstile misconfigured`) or Cloudflare could not be reached. |
| `429` while testing | Either the per-visitor limit or the form-wide limit was reached. Both are in the form's Settings; raise or disable them there. |
| Everything is accepted even though I defined fields | *Enforce this schema* is off (the default). Turn it on in Fields. |
| A consumer receives nothing new although entries exist | Its cursor is at or past the latest entry (for example after an `ack` of the newest cursor). Reset it: `{ "cursor": "beginning" }` to replay everything or `{ "back": N }` for the last N entries. |
| Views stay at 0 | The tracking snippet is not on the page, the page is not in *Allowed origins*, or the visits were ignored (no `Origin`/`Referer`, a script user agent, or an IP already counted in the last 30 minutes). See [How views are counted](/guides/analytics/#how-views-are-counted). |
| Webhook shows `failed` | Open the delivery on the Webhook page for the HTTP status or error, fix the endpoint and press *Resend*. |
| Pull API returns `401` | Missing `Authorization: Bearer fbk_…`, or the key was revoked or scoped to another form. |
