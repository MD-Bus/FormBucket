---
title: Pull API
description: Let your apps read new submissions with server-side cursors.
sidebar:
  order: 6
---

![Api](/screenshots/api.jpg)

![Api Consumers](/screenshots/api-consumers.jpg)

![Api Keys](/screenshots/api-keys.jpg)

For apps that need to *read* submissions: n8n, cron jobs, scripts, reporting.

## Authentication

Create a key under **API keys**. Keys can read submissions and manage the position of their consumers (acknowledge, reset, delete); they can **not** change or delete submissions, forms or settings. Keys look like `fbk_…`, are shown once and stored hashed. A key is scoped to all forms or to a single form.

```
Authorization: Bearer fbk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`X-API-Key: fbk_…` works too. Base URL: `https://<your-worker>/api/v1`. All responses are JSON, CORS-enabled and never cached.

## Consumers: "what is new since I last read"

A **consumer** is a named reader (`n8n-crm`, `weekly-report`) with a cursor stored on the server. It is created the first time it pulls.

```bash
# 1. pull: returns only entries after the consumer's acknowledged cursor
curl -H "Authorization: Bearer $KEY" \
  "https://your-worker.workers.dev/api/v1/forms/contact/consumers/n8n-crm/pull?limit=100"

# 2. process them, then acknowledge up to the returned cursor
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"cursor":"42"}' \
  "https://your-worker.workers.dev/api/v1/forms/contact/consumers/n8n-crm/ack"
```

- Pulling **does not move** the cursor. If your app crashes before it acknowledges, the next pull returns the same entries: **at-least-once**, never lost.
- `?ack=true` pulls and acknowledges in one call: **at-most-once**, simplest for idempotent or best-effort jobs.
- `?from=latest` (first pull only) starts at the current end instead of replaying history. Default is `beginning`.
- `?wait=25` **long polls**: the request is held open up to 25 seconds and answers as soon as something arrives.
- Cursors only move forward on `ack`. Use `reset` to move them back or jump ahead (see [Moving a cursor](#moving-a-cursor)).
- Cursors are monotonic across deletes, so nothing is skipped or repeated when submissions are removed.
- The dashboard's **API** tab shows every consumer, its unread count and last pull, with *Replay all*, *Skip to latest* and delete.

Response:

```json
{
  "data": [
    {
      "id": "sub_0mf3k2x9a8h1b2c3d4e5",
      "seq": 42,
      "form_id": "contact",
      "created_at": "2026-01-31T10:15:30.000Z",
      "data": { "name": "Jane", "email": "jane@example.com" },
      "meta": { "country": "CA", "device": "desktop", "referrer": "example.com" }
    }
  ],
  "cursor": "42",
  "has_more": false,
  "consumer": { "name": "n8n-crm", "acked_cursor": "41" }
}
```

`cursor` is the `seq` of the last entry returned (or the current position when the list is empty). Treat it as opaque and hand it back to `ack`. `has_more` tells you to pull again.

## Moving a cursor

One endpoint changes where a consumer will read next. Use it to replay history after a bug, skip a backlog, or start over.

```bash
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"back": 50}' \
  "https://your-worker.workers.dev/api/v1/forms/contact/consumers/n8n-crm/reset"
```

| Body | Effect |
|---|---|
| `{ "cursor": "beginning" }` (or `"0"`, or an empty body) | Back to the start: the next pull replays everything. |
| `{ "cursor": "latest" }` | Skip to the end: the next pull returns only entries that arrive from now on. |
| `{ "cursor": "1234" }` | Exactly this position. Must not be higher than the latest entry (`400 invalid_cursor` otherwise), because a cursor beyond the newest entry would silently skip everything that arrives before the counter reaches it. |
| `{ "back": 50 }` | **Replay the last 50 entries of this form.** The cursor is placed just before the 50th newest entry. Asking for more than exist replays everything. |

`cursor` and `back` cannot be combined (`400 invalid_reset`). The reply is `{ "ok": true, "name": "…", "acked_cursor": "…", "latest_cursor": "…" }`. `ack` still only moves forward. The dashboard's **API** tab offers the same actions as buttons (*Replay all*, *Skip to latest*).

`back` counts entries of the one form, not numbers: cursor values are shared by all forms and have gaps, so `latest - 50` would be wrong. Resetting a consumer while its app is mid-run can make that app see some entries twice or miss some, so pause the app first.

## Node.js loop

```js
const API = 'https://your-worker.workers.dev/api/v1/forms/contact'
const headers = { Authorization: `Bearer ${process.env.FORMBUCKET_KEY}` }

for (;;) {
  const res = await fetch(`${API}/consumers/my-app/pull?wait=25&limit=100`, { headers })
  const { data, cursor } = await res.json()
  for (const submission of data) await handle(submission)
  if (data.length) {
    await fetch(`${API}/consumers/my-app/ack`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cursor }),
    })
  }
}
```

## n8n

Use an **HTTP Request** node on a Schedule Trigger: `GET …/consumers/n8n/pull?ack=true`, then split `data` into items. Or skip polling and use the [webhook](/guides/webhooks/) with n8n's Webhook trigger node.
