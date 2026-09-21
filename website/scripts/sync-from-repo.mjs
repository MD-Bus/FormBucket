// Keeps one source of truth: the changelog and the screenshots live at the repository root and are copied here
// before every dev/build. The copies are git-ignored.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const site = path.resolve(here, "..")
const root = path.resolve(site, "..")

// Screenshots
const shotsFrom = path.join(root, "assets", "screenshots")
const shotsTo = path.join(site, "public", "screenshots")
fs.rmSync(shotsTo, { recursive: true, force: true })
fs.mkdirSync(shotsTo, { recursive: true })
for (const f of fs.readdirSync(shotsFrom)) fs.copyFileSync(path.join(shotsFrom, f), path.join(shotsTo, f))

// Changelog: add the frontmatter Starlight needs, rewrite links that pointed at the README.
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8").replace(/^# Changelog\s*\n/, "")
const body = changelog.replace(/\]\(README\.md#([^)]+)\)/g, "](/__README__/$1)") // resolved by the docs page map below
const map = JSON.parse(fs.readFileSync(path.join(site, "scripts", "anchor-map.json"), "utf8"))
const fixed = body.replace(/\]\(\/__README__\/([^)]+)\)/g, (_, anchor) => `](${map[anchor] ?? "/"})`).replace(/\]\(README\.md\)/g, "](/)")
// The changelog links to docs pages by repository path (so the links work on GitHub); turn them into site URLs here.
const docsLinks = fixed.replace(/\]\(website\/src\/content\/docs\/([^)#]+?)\.mdx?(#[^)]*)?\)/g, (_, page, hash) => `](/${page === "index" ? "" : page + "/"}${hash ?? ""})`)
const out = path.join(site, "src", "content", "docs", "more", "changelog.md")
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(
  out,
  `---\ntitle: Changelog\ndescription: What changed in each FormBucket version, and what to do when upgrading.\neditUrl: false\nsidebar:\n  order: 6\n---\n\nThis page is generated from [CHANGELOG.md](https://github.com/momardia54/formbucket/blob/main/CHANGELOG.md) in the repository.\n\n${docsLinks}`
)
console.log(`[docs] synced ${fs.readdirSync(shotsTo).length} screenshots and the changelog`)
