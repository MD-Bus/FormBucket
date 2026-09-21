import { defineConfig } from "astro/config"
import starlight from "@astrojs/starlight"
import starlightLinksValidator from "starlight-links-validator"

const REPO = "https://github.com/momardia54/formbucket"

export default defineConfig({
  // Set DOCS_SITE at build time (for example in Workers Builds) to your docs URL to get absolute links in the sitemap.
  site: process.env.DOCS_SITE || undefined,
  integrations: [
    starlight({
      title: "FormBucket",
      description: "Self-hosted form backend on Cloudflare Workers and D1: schemas, analytics, webhooks, a cursor-based pull API and bot protection.",
      logo: { src: "./src/assets/logo.svg", alt: "FormBucket" },
      favicon: "/favicon.svg",
      // The header GitHub link (with the star count) is a custom component.
      components: { SocialIcons: "./src/components/SocialIcons.astro" },
      lastUpdated: true,
      customCss: ["./src/styles/custom.css"],
      // Fails the build on any broken internal link, so the docs cannot quietly rot.
      plugins: [starlightLinksValidator({ errorOnInvalidHashes: true })],
      sidebar: [
        { label: "Getting started", items: [{ autogenerate: { directory: "getting-started" } }] },
        { label: "Guides", items: [{ autogenerate: { directory: "guides" } }] },
        { label: "Reference", items: [{ autogenerate: { directory: "reference" } }] },
        { label: "More", items: [{ autogenerate: { directory: "more" } }] },
      ],
    }),
  ],
})
