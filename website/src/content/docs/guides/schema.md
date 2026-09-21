---
title: Schema and validation
description: Describe your fields, then optionally enforce them.
sidebar:
  order: 2
---

![Fields](/screenshots/fields.jpg)

![Fields Enforce](/screenshots/fields-enforce.jpg)

A new form has **no schema and accepts everything**. Defining fields does not change that: a schema is documentation until you turn on **Enforce this schema** on the *Fields* page. That lets you describe your data, look at analytics and field insights, and only start blocking when you are ready.

| State | Behaviour |
|---|---|
| No fields | Everything is accepted and stored. |
| Fields defined, enforcement **off** (default) | Everything is accepted and stored. The schema only drives analytics, the generated code samples and the *Try it* tester. |
| Fields defined, enforcement **on** | Payloads that break a rule are rejected with `422` and a per-field error list, and counted in analytics. |

The *Try it* box on the Fields page validates a pasted payload against your unsaved fields. With enforcement off it still lists what *would* be rejected once you switch it on. *Add fields found in submissions* scans your latest 50 entries for field names missing from the schema and guesses their types from the values (email, number, yes/no, URL, date, otherwise text). It is simple pattern matching, not AI, and nothing is saved until you press *Save schema*.

## Field types

| Type | Accepts | Notes |
|---|---|---|
| `text` | string (numbers and booleans are converted) | Max 5,000 characters. |
| `textarea` | string | Max 20,000 characters. |
| `email` | string | Basic address check, max 254 characters, no `..`. |
| `url` | string | Must parse as an `http(s)` URL. |
| `phone` | string | Digits, spaces and `+ ( ) . -`, at least 6 digits, max 25 characters. |
| `date` | string | `YYYY-MM-DD`, optionally with a time and zone. |
| `number` | number or numeric string | Stored as a number. |
| `integer` | whole number or numeric string | Stored as a number. |
| `boolean` | `true/false`, `on/off`, `1/0`, `yes/no` | Stored as `true` / `false`. Unchecked checkboxes are simply absent. |
| `select` | one of the listed choices | With *Allow selecting several* it accepts and stores an array. |

## Rules per field

| Rule | Applies to | Description |
|---|---|---|
| Required | all | Missing, empty or whitespace-only values fail with `required`. |
| Min / Max | text types: length. `number` / `integer`: value | `too_short`, `too_long`, `too_small`, `too_large`. |
| Pattern | text types | JavaScript regular expression tested against the trimmed value (`pattern`). Anchor it yourself (`^…$`). |
| Choices | `select` | `invalid_option` when the value is not listed. |
| Label | all | Display name used in error messages. |
| Custom message | all | Replaces the default error message for that field. |

Strings are trimmed before they are checked and stored. Up to 60 fields per form, up to 100 choices per select.

## Fields that are not in the list

Only used when enforcement is on.

| Mode | Behaviour |
|---|---|
| **Reject the submission** | Any unlisted field fails with `unknown_field`. Strictest, best against junk. |
| **Drop them** | Unlisted fields are silently removed. |
| **Keep them** | Unlisted fields are stored untouched. |

## Error format

```json
{
  "ok": false,
  "error": "Some fields are missing or invalid",
  "errors": [
    { "field": "email", "code": "invalid_format", "message": "Email must be a valid email address" },
    { "field": "phone", "code": "unknown_field", "message": "Unexpected field \"phone\"" }
  ]
}
```

Codes: `required`, `invalid_type`, `invalid_format`, `invalid_option`, `too_short`, `too_long`, `too_small`, `too_large`, `pattern`, `unknown_field`, `file_not_supported`.
