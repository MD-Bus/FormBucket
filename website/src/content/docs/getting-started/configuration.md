---
title: Configuration
description: Secrets, build variables, bindings and how FormBucket names its database.
sidebar:
  order: 3
---

## Secrets

| Name | Required | Description |
|---|---|---|
| `ADMIN_USERNAME` | yes | Dashboard username. |
| `ADMIN_PASSWORD` | yes | Dashboard password. Changing it signs every session out. The dashboard shows a warning while it is shorter than 12 characters. |
| `SESSION_SECRET` | recommended | Random string (32+ characters, `openssl rand -hex 32`) that salts the visitor hashes and the credential fingerprint stored with sessions. When empty it is derived from the admin credentials. |

These are **runtime** variables. They are not needed to build or deploy, so a build without them succeeds. There are no default credentials: until both `ADMIN_USERNAME` and `ADMIN_PASSWORD` exist, nobody can log in, the login page shows a setup screen instead, and the public form endpoints keep working.

Add them after the first deploy, either way:

- **Dashboard:** Workers & Pages → your Worker → **Settings** → **Variables and Secrets** (not the *Build* section, which is build-time only) → **Add** → type **Secret** → then **Deploy**. No rebuild is needed.
- **Command line:** `npx wrangler secret put ADMIN_USERNAME --name <worker-name>` and the same for `ADMIN_PASSWORD`. Use `--name` with your deployed Worker's name (the first part of its `workers.dev` URL), which can differ from the `name` in `wrangler.jsonc`.

For local development put them in `.dev.vars` (see `.dev.vars.example`).

## Bindings

| Binding | Type | Purpose |
|---|---|---|
| `DB` | D1 | All data. Created on first deploy as `<worker-name>-db` (or `<worker-name>-<DB_SUFFIX>`). Tables are created and upgraded by the Worker itself; the SQL lives in `migrations/`. |
| cron `* * * * *` | Cron Trigger | Retries due webhook deliveries every minute; prunes old data once an hour. |

## Databases and multiple installs

`wrangler.jsonc` deliberately has **no fixed database name**. Wrangler names the database after the Worker (`<worker-name>-db`), and Worker names are unique in an account, so two FormBucket installs never share data by accident. A fixed name would make every install bind to any existing database with that name, silently, and reuse its old data and tables.

- **Several installs in one account:** give each Worker a different name. Each gets its own database.
- **Custom database name (optional build variable `DB_SUFFIX`):** the database is named `<worker-name>-<suffix>` instead of `<worker-name>-db`, for example `formbucket-x7k2`. See below.
- **Reinstalling under a name you used before:** if you deleted the Worker but not its database, the new build stops with *A database with that name already exists*. Delete the old database first (`npx wrangler d1 delete <worker-name>-db`) or pick another Worker name. To deliberately reuse a database, set its `database_id` in `wrangler.jsonc`.
- **Deleting an install:** delete its database too, or the data stays in your account.

### `DB_SUFFIX` build variable

Optional. Use it when you want to choose the database name yourself, for example to avoid a name you used before.

| | |
|---|---|
| **Where** | Cloudflare dashboard → Workers & Pages → your Worker → **Settings** → **Build** → **Variables and secrets** (a *build* variable, not a runtime one). From the command line: `DB_SUFFIX=x7k2 npm run deploy`. |
| **Value** | 1-32 letters, numbers, `-` or `_`, for example `x7k2` or `prod_01`. It is lower-cased and `_` becomes `-`. |
| **Result** | Database name `<worker-name>-<suffix>`, e.g. `formbucket-x7k2`. Not set: `<worker-name>-db`. An invalid value fails the build with a clear message. |

Things to know:

- **Set it before the first deploy and keep it.** Wrangler finds the database by name, so changing the suffix later points the Worker at a *new, empty* database. The old one and its data stay in your account.
- **A suffix already used by another install means the same database.** Pick a new value for each install.
- **The Deploy to Cloudflare button cannot use it.** The button only prompts for runtime variables and secrets, never build variables, and nothing runs before it creates the database. Button installs use `<worker-name>-db`, so choose a distinct Worker name there. To use a suffix, connect the repository through Workers Builds or deploy from the command line.
