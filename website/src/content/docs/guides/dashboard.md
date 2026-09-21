---
title: The dashboard
description: What every page of the dashboard does.
sidebar:
  order: 7
---

![Submissions](/screenshots/submissions.jpg)

![Submission Detail](/screenshots/submission-detail.jpg)

Every form has these pages in the sidebar, and there are two workspace-level pages.

| Page | What it does |
|---|---|
| **Submissions** | Total, week and month with trends, a 30-day chart, a searchable and sortable table (latest 1,000 rows, columns follow your schema order), and **CSV / JSON export** of everything (up to 100,000 rows). CSV starts with a BOM for Excel, and cells beginning with `= + - @` are prefixed with `'` so spreadsheets do not execute them. Click a row for the **submission panel**: every value with a copy button, cursor, country, device, sending site, webhook deliveries with *Resend*, and delete. |
| **Analytics** | Views, conversion, funnel, activity chart, rejections, countries, sites, devices and per-field insights for 7, 30 or 90 days. Cards show the top few and offer **View all** (a searchable list loaded 50 at a time) when there is more. Warnings appear when views were dropped by a flood or when *Allowed origins* is not set. See [Analytics](/guides/analytics/). |
| **Fields** | Schema builder, the **Enforce this schema** switch, the *Try it* tester, and *Add fields found in submissions* (simple pattern matching on your latest 50 entries, not AI). |
| **Integration** | The endpoint, HTML / JavaScript / cURL samples generated from your schema (including the Turnstile widget when it is on), and the tracking snippet. |
| **Webhook** | URL, custom headers, signing secret, *Send test event*, and the delivery log with *Resend*. See [Webhooks](/guides/webhooks/). |
| **API** | How to read submissions from your apps, every endpoint, and the list of consumers with *Replay all*, *Skip to latest* and delete. See [Pull API](/guides/pull-api/). |
| **Settings** | Name, on/off switch, allowed origins, honeypot, rate limits, [Turnstile](/guides/spam-protection/#cloudflare-turnstile-optional-per-form), [automatic blocking](/guides/spam-protection/#automatic-blocking), redirect URL, delete. |
| **API keys** (workspace) | Create, list and revoke keys. |
| **Blocked IPs** (workspace) | Block or unblock addresses and ranges. See [Blocked IPs](/guides/spam-protection/#blocked-ips). |

Light, dark or system theme (user menu, bottom left).

**Loading behaviour.** A thin bar at the top of the window shows while a page or a background request is loading, sidebar links dim while pending, and hovering a sidebar link starts loading its page before you click. How the dashboard keeps database round trips low is described under [Architecture](/more/architecture/).
