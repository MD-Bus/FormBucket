---
title: Documentation site
description: How this documentation is built, how to edit it, and how to deploy it separately from the FormBucket app.
sidebar:
  order: 5
---

This site is built with [Starlight](https://starlight.astro.build) (Astro). The pages are plain Markdown files in the repository's `website/` folder, and the sidebar is built from the folders.

## Editing a page

The pages are Markdown files in `website/src/content/docs/`. To work on them locally:

```bash
cd website
npm install
npm run dev        # http://localhost:4321, reloads as you edit
```

| To do this | Do this |
|---|---|
| Edit a page | Change the file in `website/src/content/docs/`. |
| Add a page | Create a `.md` file in the section folder with `title` and `description` in the frontmatter. It appears in the sidebar automatically. |
| Order the sidebar | Set `sidebar: { order: N }` in the page frontmatter. |
| Add a section | Add a folder and one entry to `sidebar` in `website/astro.config.mjs`. |
| Add an image | Put it in `assets/screenshots/` at the repository root; it is copied to the site before every build. |

The build fails if an internal link is broken, so if you rename or move a heading you'll find out before publishing.

The [Changelog](/more/changelog/) page is generated from `CHANGELOG.md` at the repository root and the screenshots come from `assets/screenshots/`, so they only exist in one place. Don't edit the generated copies.

## The docs are deployed separately from the app

The site is its own Cloudflare Worker (`formbucket-docs`), and the FormBucket app is another (`formbucket` by default). They live in one repository but are built and deployed independently:

| | FormBucket app | Documentation |
|---|---|---|
| Where it lives | Repository root | `website/` |
| Config | `wrangler.jsonc` at the root | `website/wrangler.jsonc` |
| Worker name | `formbucket` (yours may differ) | `formbucket-docs` |
| Deploy command | `npm run deploy` at the root | `npm run deploy` inside `website/` |

Nothing in the app's build or deploy reads `website/`, and nothing in the docs deploy touches the app, so deploying one doesn't deploy the other. The **Deploy to Cloudflare** button only looks at the repository root, so it installs the app and ignores this folder.

### Deploy the docs from the command line

```bash
cd website
npm install
npx wrangler login        # once
npm run deploy            # builds the site, then wrangler deploy
```

The first deploy creates a Worker named `formbucket-docs` and prints its address (`https://formbucket-docs.<subdomain>.workers.dev`). To give it another name, change `name` in `website/wrangler.jsonc`.

### Deploy the docs automatically on every push (Workers Builds)

In the Cloudflare dashboard go to **Workers & Pages → Create → Import a repository**, choose this repository and set:

| Setting | Value |
|---|---|
| Worker name | `formbucket-docs` (must match `website/wrangler.jsonc`) |
| Path (also called Root directory) | `website` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Build watch paths, include | `website/**`, `CHANGELOG.md`, `assets/**` |
| Build variable `DOCS_SITE` (optional) | Your docs address, for absolute links in the sitemap |

### Stop the app from rebuilding when only the docs change

If your FormBucket app is also connected to this repository with Workers Builds, open **its** *Settings → Build → Build watch paths* and **exclude** `website/**` (and, optionally, `CHANGELOG.md`). That way a push that only changes the documentation won't rebuild the app.

This only applies if you build the app from this repository. The app's own deploy never includes the docs.
