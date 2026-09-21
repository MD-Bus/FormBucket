import type { Route } from "./+types/forms.$formId.fields.$field"
import { requireAuth } from "~/server/auth.server"
import { getForm } from "~/server/forms.server"
import { getFieldInsights, parseRange } from "~/server/analytics.server"

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await getForm(env, params.formId)
  if (!form) throw new Response("Form not found", { status: 404 })
  const range = parseRange(new URL(request.url).searchParams.get("range"))
  return { insights: await getFieldInsights(env, form, params.field, range) }
}
