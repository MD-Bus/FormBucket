---
title: API endpoints
description: Every pull API endpoint, with its parameters and error codes.
sidebar:
  order: 1
---

| Method | Path | Description |
|---|---|---|
| `GET` | `/forms` | Forms the key can see, with schema, `schema_enforced` and submission counts. |
| `GET` | `/forms/:id` | One form and its `latest_cursor`. |
| `GET` | `/forms/:id/submissions` | Stateless listing, oldest first. Query: `after` (cursor), `limit` (1-500, default 100), `since` (ISO date), `wait` (0-25 s). |
| `GET` | `/forms/:id/submissions/:submissionId` | One submission. |
| `GET` | `/forms/:id/consumers` | All consumers of the form. |
| `GET` | `/forms/:id/consumers/:name` | One consumer with its cursor and `latest_cursor`. |
| `GET` / `POST` | `/forms/:id/consumers/:name/pull` | New entries. Query: `limit`, `wait`, `ack=true`, `from=latest`. |
| `POST` | `/forms/:id/consumers/:name/ack` | Body `{ "cursor": "42" }`. Only moves forward, cannot pass the latest entry. |
| `POST` | `/forms/:id/consumers/:name/reset` | Body `{ "cursor": "beginning" \| "latest" \| "<cursor>" }` or `{ "back": N }`. See *Moving a cursor*. |
| `DELETE` | `/forms/:id/consumers/:name` | Remove a consumer. |

Consumer names: letters, numbers, `_`, `-`, `.`, up to 64 characters.

Errors use one shape: `{ "error": { "code": "…", "message": "…" } }` with `401 unauthorized`, `403 forbidden`, `404 form_not_found` / `consumer_not_found` / `not_found`, `400 invalid_cursor` / `invalid_since` / `invalid_consumer`, `405 method_not_allowed`.
