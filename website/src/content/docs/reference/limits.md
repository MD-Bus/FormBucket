---
title: Limits
description: Free-plan quotas and FormBucket's own limits.
sidebar:
  order: 2
---

Approximate; check Cloudflare's current limits for your plan.

- Free plan Workers: 100,000 requests/day. D1 free: 100,000 row writes/day, 5 million row reads/day, 5 GB storage. Each accepted submission is roughly 2 writes (submission + event), plus about 2 more with a webhook (delivery row + result). Rejections and views write one event row each.
- A request body is capped at 1 MB by FormBucket. Each form also stops writing after its *form-wide limit* (default 120 events per minute), which keeps a flood well inside D1's free write quota.
- The submissions table in the dashboard shows the latest 1,000 rows; exports cover up to 100,000.
- Long polling holds a Worker request open for up to 25 seconds.
