---
title: Analytics
description: Views, conversion, funnel, rejections and per-field insights, without cookies or stored IPs.
sidebar:
  order: 4
---

![Analytics](/screenshots/analytics.jpg)

![Analytics Breakdown](/screenshots/analytics-breakdown.jpg)

![Field Insights](/screenshots/field-insights.jpg)

Every form has an **Analytics** page with a 7, 30 or 90 day range.

| Metric | Source |
|---|---|
| **Submissions** | Accepted entries. |
| **Views** | Page loads reported by the [tracking snippet](/guides/analytics/#tracking-snippet). |
| **Started** | First focus on a field of the form, also from the snippet. |
| **Conversion** | Submissions ÷ views, capped at 100%. |
| **Accepted** | Accepted ÷ (accepted + rejected). |
| **Rejected** | Submissions that failed validation, with field and reason. |
| **Blocked / spam** | Honeypot hits, disallowed origins, rate limiting, disabled form. |

Also shown: a daily activity chart, the funnel (viewed → started → submitted), the fields that fail most, countries (from Cloudflare), sites (the host of the page the request came from), devices, and a fill-rate table per field.

The Countries, Sites, Devices and *What gets rejected* cards show the top 8 (top 10 for rejections). When there is more, a **View all** button opens a searchable list of everything, loaded 50 at a time with *Load more*. Clicking a rejected field there opens its insights.

Click a field anywhere (analytics table, rejection list, submissions table header, submission panel) to open its **insights**: fill rate, distinct values, top values (the 10 most common, with *Show all* for up to 50), min/avg/max for numbers, latest values and rejection reasons.

## Tracking snippet

Add this to the page that shows your form. It is optional; without it you still get submissions, rejections and blocked traffic, just no views, starts or conversion.

```html
<script src="https://your-worker.workers.dev/f/contact/track.js" defer></script>
```

The snippet is only a link. **FormBucket counts a view each time the script runs**, so *when* it runs is up to you: include it on every page load, or only when you decide (see [Counting only new visitors](#counting-only-new-visitors-optional-recipe)).

"Started" fires when someone focuses a field inside a form whose `action` posts to your endpoint, or any form with a `data-formbucket` attribute (useful for `fetch`-based forms).

### How views are counted

Anyone can send a request to the tracking endpoint, so it filters what it counts. A view or start is counted only when **all** of these hold:

| Rule | Why |
|---|---|
| The request carries an `Origin` or `Referer` header. | Real browsers always send one. `curl` and most scripts do not, which removes the bulk of cheap spam. |
| The `User-Agent` is not a script or crawler (curl, wget, python-requests, node-fetch, axios, Googlebot and similar). | They are not people. |
| The site is in **Allowed origins**, when you have set that list. | Only your own websites count. **Recommended:** without it anyone can report views. |
| The address is not on the [Blocked IPs](/guides/spam-protection/#blocked-ips) list. | Blocked is blocked. |
| **That IP has not already been counted for the same event in the last 30 minutes.** | One view and one start per IP per 30 minutes. Reloading the page, opening it in another tab or changing the `User-Agent` does not add views. |
| The form has had fewer than 300 counted views and starts in the last minute. | Bounds how much a flood can write to your database. |

Ignored requests always get an empty `204`, and nothing tells the sender why. The IP check uses a salted hash that rotates at midnight UTC, so one visitor can be counted twice around that moment.

If a flood does reach the 300-per-minute cap, real views are dropped too. FormBucket leaves one marker per minute, and **Analytics then shows a warning** that views and conversion are understated for that period. Analytics also shows a notice while views are arriving but **Allowed origins** is empty.

### Counting only new visitors (optional recipe)

Because the snippet is just a script link, you can load it only for visitors you have not seen recently, using your own cookie. FormBucket never sets a cookie itself.

```html
<script>
  // Count one view per browser per 30 minutes; skip the tracker on every other page load.
  if (!document.cookie.includes('fb_seen=1')) {
    document.cookie = 'fb_seen=1; max-age=1800; path=/; SameSite=Lax'
    var s = document.createElement('script')
    s.src = 'https://your-worker.workers.dev/f/contact/track.js'
    document.head.appendChild(s)
  }
</script>
```

- This saves the request entirely on repeat page loads. FormBucket's own once-per-IP-per-30-minutes rule stays in place as a backstop, since nothing running in a browser can be trusted.
- The cookie belongs to your website, so any consent banner or cookie policy is your decision. FormBucket itself stays cookie-free. If you would rather not set a cookie, skip this recipe: the built-in rule already prevents double counting per IP.

## Privacy

- No cookies and no local storage.
- IP addresses of ordinary visitors are never stored. **The one exception is the Blocked IPs list**: to show and undo a block, the address (or range) that was blocked is kept until the block expires or you unblock it. Otherwise two salted hashes that rotate daily are kept: IP + user agent for unique counts, and IP alone for rate limiting and de-duplication.
- The visitor's `User-Agent` is not stored with submissions. Only the derived device class (desktop, mobile, tablet, bot) is. Submissions created by versions before 0.2 may still contain a truncated `user_agent` in their metadata.
- Submissions are kept until you delete them or the form, so remove personal data you no longer need.
- Stored per event: country, host of the referring page, device class, type, timestamp.
- Events are deleted after 180 days. Webhook deliveries that are not pending are deleted after 60 days.
