import type { Route } from "./+types/forms.$formId.analytics.$kind"
import { requireAuth } from "~/server/auth.server"
import { BREAKDOWN_KINDS, getBreakdownPage, parseRange, type BreakdownKind } from "~/server/analytics.server"

/** Paged full list behind the "View all" panels on the analytics page. */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const kind = params.kind as BreakdownKind
  if (!BREAKDOWN_KINDS.includes(kind)) throw new Response("Not found", { status: 404 })
  const exists = await env.DB.prepare("SELECT 1 FROM forms WHERE id = ?").bind(params.formId).first()
  if (!exists) throw new Response("Form not found", { status: 404 })

  const url = new URL(request.url)
  return getBreakdownPage(
    env,
    params.formId,
    parseRange(url.searchParams.get("range")),
    kind,
    url.searchParams.get("q") ?? "",
    Number(url.searchParams.get("offset") ?? 0) || 0
  )
}
