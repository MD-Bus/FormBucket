---
title: Deploy
description: Deploy FormBucket to your Cloudflare account with one click or from the command line.
sidebar:
  order: 2
---

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/momardia54/formbucket)

## One click

1. Click the **Deploy to Cloudflare** button and sign in.
2. Cloudflare copies the repository into your GitHub account, creates the D1 database and asks for:
   - `ADMIN_USERNAME`: the dashboard username
   - `ADMIN_PASSWORD`: the dashboard password (12+ characters, stored as an encrypted secret)
   - `SESSION_SECRET`: optional, see [Configuration](/getting-started/configuration/)
3. Wait for the build. You do not need to run any database commands: **FormBucket creates and upgrades its own database tables** the first time it receives a request after a deploy.
   If the flow does not let you set the variables (for example when you connect the repository in **Workers Builds** or the dashboard's *Import a repository* flow, which only offers build-time variables), skip them. **The build does not need them and never fails without them.**
4. Open the Worker URL (`https://<name>.<subdomain>.workers.dev`). If the admin variables are not set yet, the login page turns into a **setup screen** that lists what is missing and how to add it ([Configuration](/getting-started/configuration/)). Once they are set, sign in and create your first form.

Every push to your copy of the repository redeploys.

## From the command line

```bash
git clone https://github.com/momardia54/formbucket && cd formbucket
npm install
npx wrangler login
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
npm run deploy        # build and deploy; the Worker creates its own tables
```

The first deploy creates a D1 database named `<worker-name>-db` (for example `formbucket-db`) and every later deploy keeps using it. To use an existing database instead, add its `database_id` under `d1_databases` in `wrangler.jsonc`.
