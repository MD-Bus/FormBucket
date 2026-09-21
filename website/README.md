# FormBucket documentation

The documentation website, built with [Starlight](https://starlight.astro.build) (Astro). It is a separate Cloudflare Worker (`formbucket-docs`) from the FormBucket app in the repository root.

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # static site in dist/, fails on broken internal links
npm run deploy     # build + wrangler deploy
```

Pages are Markdown files in `src/content/docs/`; the sidebar is built from the folders. The changelog and screenshots are copied from the repository root before every build (`scripts/sync-from-repo.mjs`), so they are not edited here.

Full guide: [`src/content/docs/more/docs-site.md`](src/content/docs/more/docs-site.md), also published on the site under *More → Documentation site*.
