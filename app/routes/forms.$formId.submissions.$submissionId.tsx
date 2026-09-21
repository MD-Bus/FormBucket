import { data } from "react-router"
import type { Route } from "./+types/forms.$formId.submissions.$submissionId"
import { requireAuth } from "~/server/auth.server"
import { parseSubmission, type SubmissionRow } from "~/server/forms.server"
import { resendDelivery } from "~/server/webhook.server"

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)

  const row = await env.DB.prepare("SELECT seq, id, form_id, data, meta, created_at FROM submissions WHERE id = ? AND form_id = ?")
    .bind(params.submissionId, params.formId)
    .first<SubmissionRow>()
  // Not a 404: this loader re-runs after the submission is deleted (fetcher revalidation)
  // and throwing here would replace the whole page with the error boundary.
  if (!row) return { submission: null, deliveries: [] }

  const deliveries = await env.DB.prepare(
    `SELECT id, event, url, status, attempts, response_status, error, next_attempt_at, updated_at
     FROM webhook_deliveries WHERE submission_id = ? ORDER BY created_at DESC LIMIT 10`
  )
    .bind(params.submissionId)
    .all<{
      id: string
      event: string
      url: string
      status: "pending" | "success" | "failed"
      attempts: number
      response_status: number | null
      error: string | null
      next_attempt_at: number | null
      updated_at: number
    }>()

  return { submission: parseSubmission(row), deliveries: deliveries.results }
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)

  if (request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM submissions WHERE id = ? AND form_id = ?")
      .bind(params.submissionId, params.formId)
      .run()
    if (result.meta.changes === 0) return data({ success: false, error: "Submission not found" }, { status: 404 })
    return data({ success: true })
  }

  if (request.method === "POST") {
    const form = await request.formData()
    if (form.get("intent") === "resend") {
      const deliveryId = String(form.get("delivery") ?? "")
      const owned = await env.DB.prepare("SELECT 1 FROM webhook_deliveries WHERE id = ? AND form_id = ? AND submission_id = ?")
        .bind(deliveryId, params.formId, params.submissionId)
        .first()
      if (!owned) return data({ success: false, error: "Delivery not found" }, { status: 404 })
      await resendDelivery(env, deliveryId)
      return data({ success: true })
    }
  }

  return data({ success: false, error: "Method not allowed" }, { status: 405 })
}
