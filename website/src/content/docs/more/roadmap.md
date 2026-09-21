---
title: Road to 1.0.0
description: What still needs doing before FormBucket reaches 1.0.0.
sidebar:
  order: 7
---

This is the to-do list for 1.0.0. We tick things off as they get done and add new ones when we find them. The current version is 0.3.0.

## What 1.0.0 means

Once we release 1.0.0, a change that breaks existing setups only goes into a new major version. So before that we want to be happy with these parts, because they are the ones other people build on:

- what `POST /f/:id` accepts and what it returns
- the `/api/v1` requests and responses, including how cursors behave
- the webhook payload and its signature
- the configuration variables (secrets and build variables)
- upgrading without losing data (migrations only add things)

Until then the version stays at 0.x and a minor release can change any of this. For how version numbers work, see [Branches and releases](/more/development/#branches-and-releases) and the [Changelog](/more/changelog/).

## Already done

- [x] The core features: forms, schema with optional enforcement, analytics, webhooks, pull API with cursors, dashboard
- [x] Bot protection: honeypot, Cloudflare Turnstile, rate limits, automatic blocking, Blocked IPs
- [x] A security review of our own code, with every finding fixed
- [x] Server-side sessions, security headers and a CSP with nonces
- [x] Automatic database migrations, and database names that don't clash between installs
- [x] A setup screen for when the admin login isn't configured yet
- [x] A faster dashboard (batched queries, fewer reloads, prefetch)
- [x] Test deploys with Wrangler on a real account (naming, migrations, login, redeploy)
- [x] The documentation site, the changelog and the `develop` / `main` branches

## 1. Test the install paths

Most people will probably install with the Deploy button or by connecting the repository in the Cloudflare dashboard. We have only tested deploys with Wrangler so far.

- [ ] Deploy with the **Deploy to Cloudflare button** under a throwaway Worker name and check the database name, the setup screen, the migrations and signing in
- [ ] Install by **connecting the repository (Workers Builds)** and check the build and deploy commands, the build watch paths and the `DB_SUFFIX` build variable
- [ ] Ask someone else to **follow the Quickstart from scratch** and fix whatever confuses them
- [ ] Check the free plan's **limit on cron triggers** (we think it is 5 per account) and either document it or make the cron optional
- [ ] Publish the docs site and point the README links at it
- [ ] Try the release process once: a beta tag from `develop`, then a stable tag from `main`

## 2. Automated checks and more testing

- [ ] **GitHub Actions** on `develop` and `main` running the typecheck, the unit tests and the docs build (which fails on broken links)
- [ ] **End-to-end tests** against a local Worker covering submit, store, pull with a cursor, webhook delivery, block and unblock
- [ ] Check **Firefox, Safari and a phone-sized window** (login, dashboard, tracking snippet). Only Chrome was checked after the security header changes
- [ ] Try **Turnstile with a real widget** on a real page. So far we only used Cloudflare's test keys
- [ ] A **load test** with a steady stream of submissions, to see how the form-wide limit behaves against D1's limits
- [ ] A keyboard and contrast pass over the dashboard

## 3. Settle the public API

These are easy to change now and hard to change after 1.0.0, so each one needs a decision before the release candidate.

- [ ] The behaviour and status codes of `/f/:id`
- [ ] The `/api/v1` response format, error format, and how cursors and consumers work
- [ ] **API key permissions.** Keys can currently manage consumer cursors. Decide whether to split them into read-only and manage keys
- [ ] **Webhook payload and signature.** Decide whether to version the signature or add an event id
- [ ] Which secrets are required, and whether `SESSION_SECRET` should be required or generated automatically
- [ ] Write the **upgrade and deprecation policy** in the docs: that migrations only add things, and what we count as a breaking change

## 4. Security

- [ ] Get an **independent review** of login, sessions, headers and the public endpoints, from another person or an outside tool
- [ ] Add a **SECURITY.md** and turn on GitHub's private vulnerability reporting
- [ ] Set up **Dependabot** and run `npm audit` in the CI checks
- [ ] Decide whether the single shared admin login is enough or whether to add a second factor

## 5. Product gaps

Each of these is either fixed before 1.0.0 or written down as something we chose to leave out.

- [ ] Limit the size of a **pull API response**. 500 entries of up to 1 MB each could get very large
- [ ] Make the automatic migrator **refuse a database that isn't FormBucket's**, and show an install id and schema version in Settings
- [ ] An optional **retention setting** that deletes submissions after N days
- [ ] Run the session, form and page queries **in parallel** (worth about 40 to 60 ms per click) and try **Smart Placement**
- [ ] A compare-and-set for consumer `ack` and `reset`, so two workers using the same consumer name can't overwrite each other

## 6. Documentation and project files

- [ ] Screenshots of **Blocked IPs**, the **Turnstile settings** and the **setup screen**
- [ ] A `CONTRIBUTING.md` and issue templates
- [ ] A docs page for every setting and endpoint, with the link check passing

## Release plan

| Step | Version | What goes in |
|---|---|---|
| 1 | `v0.3.0` (pre-release) | What exists today |
| 2 | `v0.4.0` | Sections 1 and 2: install paths tested, CI, end-to-end tests, browser checks |
| 3 | `v0.5.0` (if needed) | Sections 4 and 5: security review and the remaining gaps |
| 4 | `v1.0.0-rc.1` | Section 3 done. We run real forms on it for a week or two |
| 5 | `v1.0.0` | Nothing broke while testing the release candidate |

Beta builds (`v0.4.0-beta.1` and so on) are tagged from `develop` in between. See [Branches and releases](/more/development/#branches-and-releases).
