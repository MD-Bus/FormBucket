---
title: Development
description: Run FormBucket locally, run the tests, and find your way around the code.
sidebar:
  order: 4
---

```bash
cp .dev.vars.example .dev.vars      # set ADMIN_USERNAME / ADMIN_PASSWORD
npm install
npm run dev                         # applies migrations to a local D1, starts Vite on :5173
npm test                            # unit tests
npm run typecheck
npm run build && npm run preview    # production build against local D1
```

| Path | Contents |
|---|---|
| `workers/app.ts` | Worker entry: routes `/f/*` and `/api/v1/*`, dashboard handler, cron. |
| `app/server/` | Server-only code: `ingest` (public endpoints), `webhook`, `api` (pull API), `analytics`, `auth` (sessions), `blocks` (Blocked IPs), `turnstile`, `migrate` (automatic migrations), `headers` (CSP and security headers), `request-cache`. |
| `app/lib/` | Code shared by the Worker and the dashboard: `schema` (field types, validation), `ip` (IPv4/IPv6/CIDR), `device`, `worker-name`. |
| `scripts/` | Build helpers: `set-database-suffix.mjs` (the optional `DB_SUFFIX` variable). |
| `app/routes/` | Dashboard pages. |
| `app/components/ui/` | shadcn/ui components. |
| `migrations/` | D1 migrations, applied in order. |
| `tests/` | Unit tests (`npm test`): validation, IP and CIDR handling, Turnstile, security headers, request bodies, migrations, database naming. |
| `CHANGELOG.md` | What changed in each version. |

To exercise the cron locally, request `/cdn-cgi/handler/scheduled` on the dev server.

## Documentation is part of the change

When you add or change a feature, update its page in the same commit: the pages live in `website/src/content/docs/`, one per topic, and the sidebar builds itself. Add a line to `CHANGELOG.md` too. The docs build fails on broken internal links, so renaming a heading you link to is caught immediately. How to run, edit and deploy the docs site: [Documentation site](/more/docs-site/).

| You changed | Update |
|---|---|
| A setting, endpoint or behaviour | The matching page under **Guides** or **Reference**. |
| Something that can go wrong | [Troubleshooting](/more/troubleshooting/). |
| The database schema | A new migration, the migrations table in [Architecture](/more/architecture/), and the changelog. |
| Anything a user must do when upgrading | The "Upgrading" notes in the changelog. |

## Branches and releases

| Branch | Purpose | Rule |
|---|---|---|
| **`main`** (GitHub default) | What people install, and where stable releases come from. | Should always work. It only changes when `develop` is merged into it after testing and approval. |
| **`develop`** | Where all day-to-day work is pushed. | Can be a bit rough, but it should build and pass the tests. |
| Feature branches (optional) | Bigger or riskier work. | Branch from `develop`, merge back into `develop`. |

The **Deploy to Cloudflare** button installs from the default branch, so `main` needs to stay stable. Don't push to `main` directly, apart from maybe a typo fix.

### Day to day

1. Work and push on `develop`.
2. Test it: run the unit tests, build the docs and try out the behaviour you changed (see [Documentation is part of the change](#documentation-is-part-of-the-change)).
3. When it is approved, merge `develop` into `main` (a merge commit or fast-forward, **not a squash**, so the two branches keep the same history).
4. After a hotfix that landed on `main`, merge `main` back into `develop`.

### Version tags

- **Beta** builds are tagged from `develop` with a SemVer pre-release label, for example `v0.4.0-beta.1`, `v0.4.0-beta.2`. They sort before the real `v0.4.0`. Publish them as GitHub **pre-releases**.
- **Stable** releases are tagged from `main` after the merge: `v0.4.0`. Bump `package.json` (root and `website/`) and add the section to `CHANGELOG.md` when you cut the stable release; beta tags carry their label in the tag only.
- Don't move or reuse a tag. If something is wrong, release the next number. What the numbers mean is explained in the [changelog](/more/changelog/) and follows [Semantic Versioning](https://semver.org).

The docs site and the app are deployed separately; connect the app's Workers Builds project to `main` as its production branch. Builds of `develop` are previews, so you get a preview address to try before merging. See [Documentation site](/more/docs-site/).

