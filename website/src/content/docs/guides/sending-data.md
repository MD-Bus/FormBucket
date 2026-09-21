---
title: Sending data
description: Post to a form from HTML, JavaScript or cURL, and what comes back.
sidebar:
  order: 1
---

![Integration](/screenshots/integration.jpg)

Every form has an endpoint: `https://<your-worker>/f/<form-id>`. The form id is the slug shown in the sidebar (created from the form name, never changes).
`POST /api/forms/<form-id>/submissions` is accepted as an alias.

## HTML form

```html
<form action="https://your-worker.workers.dev/f/contact" method="POST">
  <input type="text"  name="name"  required>
  <input type="email" name="email" required>
  <textarea name="message"></textarea>

  <!-- Honeypot: hidden from people, bots fill it in -->
  <input type="text" name="_gotcha" style="display:none" tabindex="-1" autocomplete="off">

  <button type="submit">Send</button>
</form>
```

After a successful post the visitor is redirected (`303`) to the form's *Redirect URL*, or sees a small built-in thank-you page when none is set.

## JavaScript

```js
const res = await fetch('https://your-worker.workers.dev/f/contact', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Ada', email: 'ada@example.com', message: 'Hello' }),
})
const result = await res.json()
if (res.ok) console.log('stored as', result.id)
else console.error(result.errors) // [{ field, code, message }]
```

## cURL

```bash
curl -X POST https://your-worker.workers.dev/f/contact \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com"}'
```

## Request rules

- **Content types:** `application/json`, `application/x-www-form-urlencoded`, `multipart/form-data`. Anything else is parsed as JSON if it can be.
- **Size:** 1 MB maximum, enforced while the body is being read, whatever the client sends (`Content-Length`, chunked or none). Larger bodies get `413`.
- **Repeated keys** (checkbox groups) arrive as arrays. They are accepted by `Choice` fields with *Allow selecting several*, and rejected by single-value fields.
- **Reserved keys:** keys starting with `_` (for example `_gotcha`) are control values. They are read and then dropped, never stored.
- **Files:** uploads are not supported. A non-empty file input is reported as a `file_not_supported` error.
- **CORS:** answered by the Worker. With no allowed origins configured it replies `Access-Control-Allow-Origin: *`; with an allowlist it echoes the matching origin.

## Responses

JSON is returned when the request is JSON, sends `Accept: application/json` (without `text/html`) or has `X-Requested-With: XMLHttpRequest`. Otherwise the visitor gets a redirect or a small HTML page.

| Status | When | JSON body |
|---|---|---|
| `200` | Accepted (also returned for honeypot hits, on purpose) | `{ "ok": true, "id": "sub_…" }` |
| `303` | Accepted, HTML post with a redirect URL | none |
| `400` | Unreadable body, not a JSON object | `{ "ok": false, "error": "…" }` |
| `403` | Form disabled, or origin not allowed | `{ "ok": false, "error": "…" }` |
| `404` | Unknown form | `{ "ok": false, "error": "Form not found" }` |
| `413` | Body over 1 MB | `{ "ok": false, "error": "Payload too large" }` |
| `422` | Schema enforced and the payload does not match | `{ "ok": false, "errors": [{ "field", "code", "message" }] }` |
| `429` | Rate limit hit (`Retry-After: 60`) | `{ "ok": false, "error": "…" }` |
