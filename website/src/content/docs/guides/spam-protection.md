---
title: Spam protection and blocking
description: Honeypot, allowed origins, rate limits, Cloudflare Turnstile, automatic blocking and the Blocked IPs list.
sidebar:
  order: 3
---

Configured per form under **Settings**.

| Setting | Default | Behaviour |
|---|---|---|
| **Accepting submissions** | on | Off returns `403` for everything while keeping existing data. |
| **Allowed origins** | empty (anyone) | One per line: `https://example.com`, `example.com` or `*.example.com`. When set, requests must carry an `Origin` (or `Referer`) from a listed site, so plain server-side calls without one are refused. Leave it empty to post from servers. |
| **Honeypot field** | `_gotcha` | A hidden input bots tend to fill. A non-empty value is accepted with a normal success response but nothing is stored, and it is counted as *spam* in analytics. |
| **Rate limit** | 10 per minute | Per visitor IP, counting accepted, rejected, spam and blocked requests in the last 60 seconds. Changing the `User-Agent` does not reset it. `0` disables it. |
| **Form-wide limit** | 120 per minute | Backstop for floods from many different visitors. Once this many accepted, rejected, spam and blocked requests happen within a minute, further requests get `429` and **nothing more is written** to the database. Set it above your busiest legitimate minute. `0` disables it. |
| **Redirect URL** | none | Where HTML form posts go after success. Only this saved URL is used, never a URL from the request, so there is no open redirect. |

Limits work on a salted, daily-rotating hash of the IP address (never the address itself), so they reset when the day rolls over and nothing personal is stored.

## Cloudflare Turnstile (optional, per form)

Turnstile is a free, mostly invisible check that proves a real browser is sending the form. Your form page adds a small widget, and FormBucket verifies the result with Cloudflare. **Your clients write no server code**, but they do add the widget to their page.

1. In the Cloudflare dashboard open **Turnstile → Add widget**, add the domain that hosts your form, and copy the **site key** and **secret key**.
2. In the form's **Settings → Bot protection** paste both keys and switch **Require Turnstile** on. The secret is stored on your server and is never shown again.
3. Add the widget to your form. The **Integration** tab shows the exact snippet for your site key:

```html
<form action="https://your-worker.workers.dev/f/contact" method="POST">
  <!-- your fields -->
  <div class="cf-turnstile" data-sitekey="YOUR_SITE_KEY"></div>
  <button>Send</button>
</form>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
```

A plain HTML form sends the token by itself. With `fetch`, read it with `turnstile.getResponse()` and send it as the field `cf-turnstile-response` (each token works once, so reset the widget after a submission). The field is checked and then removed, so it is never stored and never counts as an unknown field.

| Situation | Result |
|---|---|
| Valid token | Continues to schema validation. |
| Missing or failed token | `403`, counted in analytics as `turnstile failed`, and counts towards [automatic blocking](/guides/spam-protection/#automatic-blocking). |
| Wrong secret key in Settings | `503` and analytics show `turnstile misconfigured`. Never counted against the visitor. |
| Cloudflare unreachable | `503` (`turnstile unavailable`). Never counted against the visitor. |

Turnstile needs a browser, so leave it **off** for forms that receive server-to-server posts. Cloudflare's [test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) (for example secret `1x0000000000000000000000000000000AA`, which always passes) let you try it without a real widget.

## Automatic blocking

In each form's **Settings → Automatic blocking** you can block visitors who keep tripping your bot traps. There is one rule per trap:

- **Honeypot hits:** a bot filled the hidden field.
- **Failed Turnstile checks.**

Each rule reads: *block after **N** attempts within an hour, for **X** hours / days / permanently.* `0` attempts switches the rule off (the default). When the threshold is reached, the visitor's address is added to the **Blocked IPs** list and refused on **every** form of the install. An IPv4 visitor is blocked by their exact address; an IPv6 visitor by their whole `/64` network, because one subscriber usually controls all of it. Attempts are counted per day-rotating visitor hash, so a count that straddles midnight UTC starts over.

## Blocked IPs

The **Blocked IPs** page (Workspace → sidebar) lists every active block with its address, why it was blocked (manual, honeypot or Turnstile), the form that triggered it, a note, when it was created and when it expires. You can:

- **Block manually:** enter an IPv4 or IPv6 address, or a range in CIDR form (`203.0.113.0/24`, `2001:db8::/48`), pick a duration (1 hour, 24 hours, 7 days, 30 days or permanent) and add an optional note.
- **Unblock** any entry with one click.
- **Search** the list; it is paged 50 at a time.

Safety rules: ranges broader than `/16` (IPv4) or `/32` (IPv6) are refused, and so is a range that contains your own address. IPv4-mapped IPv6 addresses are treated as the IPv4 address they wrap. Blocks apply to the public form endpoints and the tracking beacons only, never to the dashboard or the pull API, so a block can never lock you out.

Blocked requests are refused **before any database access**: the active list is held in memory, so a flood from a blocked address costs nothing. Blocks and settings changes reach every running instance within about 10 seconds. Expired blocks are deleted automatically once an hour.

For blocking at the network edge, before a request even reaches your Worker, use a free Cloudflare **WAF custom rule** on `/f/*`. FormBucket cannot know an address before the request arrives, and it deliberately never logs the addresses of ordinary visitors.
