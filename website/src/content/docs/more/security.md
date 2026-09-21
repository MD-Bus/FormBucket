---
title: Security
description: How authentication, sessions, headers, public endpoints, API keys and webhooks are protected.
sidebar:
  order: 1
---

**Authentication and sessions**

- Credentials come from Worker secrets and are compared in constant time.
- Sessions are **server-side**. The cookie is a 256-bit random token with no data in it; only its hash is stored in D1. It cannot be forged or inspected, and it reveals nothing about your password.
- Logging out deletes the session on the server, so a copied cookie stops working immediately. Changing `ADMIN_PASSWORD` invalidates every session. Sessions last 7 days.
- The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS.
- Login is limited to 8 failed attempts per IP in 15 minutes. When many failures pile up across all IPs, every attempt is also slowed (up to 3 seconds) without locking you out.
- Dashboard mutations require a same-origin request (React Router's origin check plus an explicit `Origin` comparison).
- The dashboard warns when the admin password is shorter than 12 characters.

**Browser hardening (dashboard)**

- `Content-Security-Policy` with per-request nonces: only scripts served by the app itself run, no inline script without the nonce, no plugins, `frame-ancestors 'none'`, `form-action 'self'`.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Strict-Transport-Security` on HTTPS, and `Cache-Control: no-store` on every dashboard response.
- User-provided values are rendered by React (escaped). The public error page escapes everything it prints.

**Public endpoints**

- Body size is capped while reading, for every content type.
- Per-IP rate limit, form-wide limit and beacon caps bound how much a flood can write (see [Spam and access control](/guides/spam-protection/)).
- Keys such as `__proto__` are dropped and names such as `constructor` or `toString` are stored like any other field, so payloads cannot tamper with object prototypes.
- Only the saved redirect URL is ever used, so there are no open redirects.

**API keys and webhooks**

- API keys: 40 random characters, only their SHA-256 is stored, cannot edit or delete submissions, forms or settings (they can manage consumer cursors), optionally scoped to one form (a scoped key gets `403` on every other form).
- Webhooks are signed, time-limited (10 s), do not follow redirects, and refuse private, loopback and self-referencing targets. Custom headers cannot override protocol headers.

**Data**

- CSV exports neutralise cells that could run as spreadsheet formulas.
- Everything is stored in your own D1 database in your own Cloudflare account. Nothing leaves it except webhook calls to URLs you configure.

**What FormBucket does not protect against**

- A determined botnet with many IP addresses can still submit junk within the rate limits. Turn on **Turnstile** for browser forms, use automatic blocking, and add a Cloudflare WAF rate-limiting rule for `/f/*` for volumetric attacks.
- The origin allowlist stops other *websites* using your endpoint; it cannot stop scripts, which can send any `Origin` header.
- Submissions are not scanned for spam content. Use the honeypot and schema enforcement.
