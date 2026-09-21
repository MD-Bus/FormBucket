---
title: Updating
description: How to update an existing install, and what happens to your data.
sidebar:
  order: 4
---

If you deployed with the button, pull upstream changes into your copy of the repository and push. New database migrations are applied automatically by the Worker on the first request after an update, so UI-based installs need no extra step and existing data is kept. Migrations only ever add to the schema. If an automatic upgrade ever fails, the site shows a clear *Database upgrade failed* page with the fallback command `npx wrangler d1 migrations apply <worker-name>-db --remote`. After updating to 0.2 you are asked to sign in once more, because sessions moved from signed cookies to server-side sessions.

From the command line: `git pull && npm install && npm run deploy`.

What changed in each version, and anything you need to do when upgrading, is in [CHANGELOG.md](/more/changelog/).
