---
title: Webhooks
description: Send every submission to a URL, signed and retried automatically.
sidebar:
  order: 5
---

![Webhook](/screenshots/webhook.jpg)

![Webhook Deliveries](/screenshots/webhook-deliveries.jpg)

Each form can post every accepted submission to one URL (n8n, Zapier, Make, your own server).

Configure it on the **Webhook** page: enable it, set the URL, add optional custom headers (one `Name: value` per line, for example `Authorization: Bearer …`), then use **Send test event** to check it.

## Request

`POST` with `Content-Type: application/json`:

```json
{
  "event": "submission.created",
  "form": { "id": "contact", "name": "Contact" },
  "submission": {
    "id": "sub_0mf3k2x9a8h1b2c3d4e5",
    "seq": 42,
    "form_id": "contact",
    "created_at": "2026-01-31T10:15:30.000Z",
    "data": { "name": "Jane", "email": "jane@example.com" },
    "meta": { "country": "CA", "device": "desktop", "referrer": "example.com" }
  }
}
```

| Header | Value |
|---|---|
| `X-FormBucket-Event` | `submission.created` or `test` |
| `X-FormBucket-Delivery` | Unique delivery id |
| `X-FormBucket-Timestamp` | Unix seconds |
| `X-FormBucket-Signature` | `sha256=` + hex `HMAC_SHA256(secret, timestamp + "." + rawBody)` |
| `User-Agent` | `FormBucket-Webhook/1.0` |

Your endpoint must answer with any `2xx` within 10 seconds. Redirects are not followed and count as failures. Custom headers cannot override `Content-Type`, `Host`, `Content-Length`, `User-Agent` or any `X-FormBucket-*` header.

## Verifying the signature

The secret (`whsec_…`) is created the first time you save the webhook and shown on the Webhook page. Verify against the **raw** body, before parsing JSON.

```js
import crypto from 'node:crypto'

export function verify(rawBody, headers, secret) {
  const timestamp = headers['x-formbucket-timestamp']
  const signature = headers['x-formbucket-signature']
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  return signature?.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}
```

```python
import hmac, hashlib

def verify(raw_body: bytes, headers, secret: str) -> bool:
    ts = headers["X-FormBucket-Timestamp"]
    expected = "sha256=" + hmac.new(secret.encode(), f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(headers["X-FormBucket-Signature"], expected)
```

Reject requests whose timestamp is more than a few minutes old to prevent replays.

## Delivery and retries

The delivery row is written before the visitor gets their response, the first attempt runs right after it, and the cron trigger retries what fails:

| Attempt | Delay after the previous failure |
|---|---|
| 1 | immediately |
| 2 | 1 minute |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5 | 2 hours |
| 6 | 6 hours, then the delivery is marked `failed` |

The **Recent deliveries** table on the Webhook page and the panel of each submission show status, attempts, HTTP status and error. **Resend** resets a delivery and tries again immediately. The webhook URL must be a public `http(s)` address. Localhost, private and link-local ranges, IPv6 loopback and IPv4-mapped addresses, DNS names that resolve to loopback (`localtest.me`, `nip.io`, `sslip.io` and similar) and this FormBucket itself (which would loop) are refused when you save it.
