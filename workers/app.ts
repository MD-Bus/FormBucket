import { createRequestHandler } from "react-router"
import { handleApi } from "../app/server/api.server"
import { handleBeacon, handleSubmit, trackerScript } from "../app/server/ingest.server"
import { pruneOldData } from "../app/server/analytics.server"
import { processDueDeliveries } from "../app/server/webhook.server"
import { pruneExpiredBlocks } from "../app/server/blocks.server"
import { withDashboardHeaders } from "../app/server/headers.server"
import { initRequestCache } from "../app/server/request-cache.server"
import { ensureMigrated, migrationFailureResponse, type Migration } from "../app/server/migrate.server"

// Migration files are bundled so the Worker can bring an older database up to date by itself.
const migrations: Migration[] = Object.entries(
  import.meta.glob("../migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>
).map(([path, sql]) => ({ name: path.split("/").pop()!, sql }))

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env
      ctx: ExecutionContext
      /** Per-request CSP nonce for inline scripts. */
      nonce: string
    }
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const path = url.pathname

    try {
      await ensureMigrated(env.DB, migrations)
    } catch (error) {
      return migrationFailureResponse(request, error)
    }

    // Public form endpoints (POST /f/:id, tracking beacons, tracker script).
    // Alias /api/forms/:id/submissions keeps parity with FormZero endpoints.
    const submit = path.match(/^\/(?:f|api\/forms)\/([^/]+?)(?:\/submissions)?\/?$/)
    if (submit) return handleSubmit(request, env, ctx, decodeURIComponent(submit[1]))

    const beacon = path.match(/^\/f\/([^/]+)\/(view|start)$/)
    if (beacon) return handleBeacon(request, env, ctx, decodeURIComponent(beacon[1]), beacon[2] as "view" | "start")

    const script = path.match(/^\/f\/([^/]+)\/track\.js$/)
    if (script) return trackerScript(request, decodeURIComponent(script[1]))

    if (path.startsWith("/api/v1/") || path === "/api/v1") return handleApi(request, env)

    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
    // A per-request copy of env: it is the key of the request-scoped cache (see request-cache.server.ts).
    const requestEnv = { ...env } as Env
    initRequestCache(requestEnv, request)
    const response = await requestHandler(request, { cloudflare: { env: requestEnv, ctx, nonce } })
    return withDashboardHeaders(response, request)
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(processDueDeliveries(env))
    // Prune once an hour.
    if (new Date().getUTCMinutes() === 0) {
      ctx.waitUntil(pruneOldData(env))
      ctx.waitUntil(pruneExpiredBlocks(env))
    }
  },
} satisfies ExportedHandler<Env>
