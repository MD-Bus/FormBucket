import { getForm, publicSubmission, type FormConfig, type Submission } from "./forms.server"
import { hmacHex, newId } from "./util.server"

/** Delay before retry N (attempt 1 fails -> wait 1 min, ...). 6 attempts in total. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000]
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1
const REQUEST_TIMEOUT_MS = 10_000

const PRIVATE_HOST = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^\[::/,                        // ::1, ::, and IPv4-mapped/compatible forms such as ::ffff:127.0.0.1
  /^\[?f[cd][0-9a-f]{2}:/i,
  /^\[?fe[89ab][0-9a-f]:/i,       // link-local fe80::/10
  // Public DNS names that intentionally resolve to loopback / private addresses.
  /(^|\.)(localtest\.me|lvh\.me|vcap\.me|nip\.io|sslip\.io|xip\.io)$/i,
]

/** Returns an error message, or null when the URL is acceptable. */
export function validateWebhookUrl(raw: string, allowPrivate = false, selfHost?: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return "Webhook URL is not a valid URL"
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "Webhook URL must start with http:// or https://"
  if (url.username || url.password) return "Put credentials in a header instead of the URL"
  // A webhook that posts back into this Worker would create a submission -> webhook -> submission loop.
  if (selfHost && url.host.toLowerCase() === selfHost.toLowerCase()) return "Webhook URL cannot point at this FormBucket"
  if (!allowPrivate && PRIVATE_HOST.some((re) => re.test(url.hostname))) return "Webhook URL must point to a public host"
  return null
}

export function buildPayload(form: Pick<FormConfig, "id" | "name">, submission: Submission, event = "submission.created") {
  return {
    event,
    form: { id: form.id, name: form.name },
    submission: publicSubmission(submission),
  }
}

export async function signPayload(secret: string, timestamp: string, body: string): Promise<string> {
  return `sha256=${await hmacHex(secret, `${timestamp}.${body}`)}`
}

type SendResult = { ok: boolean; status: number | null; error: string | null }

async function send(
  form: Pick<FormConfig, "webhook_secret" | "webhook_headers">,
  url: string,
  deliveryId: string,
  event: string,
  body: string
): Promise<SendResult> {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const headers = new Headers({ "content-type": "application/json", "user-agent": "FormBucket-Webhook/1.0" })
  for (const [k, v] of Object.entries(form.webhook_headers ?? {})) {
    try {
      headers.set(k, v)
    } catch {}
  }
  headers.set("x-formbucket-event", event)
  headers.set("x-formbucket-delivery", deliveryId)
  headers.set("x-formbucket-timestamp", timestamp)
  if (form.webhook_secret) {
    headers.set("x-formbucket-signature", await signPayload(form.webhook_secret, timestamp, body))
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    // Drain so the connection can be reused.
    await res.arrayBuffer().catch(() => {})
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, error: null }
    return { ok: false, status: res.status, error: `Endpoint responded with HTTP ${res.status}` }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, status: null, error: message.slice(0, 300) }
  }
}

/** Prepared INSERT for a pending delivery, meant to be added to a db.batch(). */
export function deliveryInsert(env: Env, form: FormConfig, submission: Submission) {
  const id = newId("whd")
  const now = Date.now()
  const payload = JSON.stringify(buildPayload(form, submission))
  const stmt = env.DB.prepare(
    `INSERT INTO webhook_deliveries (id, form_id, submission_id, event, url, payload, status, attempts, next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, 'submission.created', ?, ?, 'pending', 0, ?, ?, ?)`
  ).bind(id, form.id, submission.id, form.webhook_url, payload, now, now, now)
  return { id, stmt }
}

/** Tries one delivery. Safe to call concurrently: the row is claimed first. */
export async function attemptDelivery(env: Env, deliveryId: string): Promise<void> {
  const now = Date.now()
  const claim = await env.DB.prepare(
    `UPDATE webhook_deliveries SET next_attempt_at = ?, updated_at = ?
     WHERE id = ? AND status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)`
  )
    .bind(now + 2 * 60_000, now, deliveryId, now)
    .run()
  if (claim.meta.changes === 0) return

  const row = await env.DB.prepare("SELECT * FROM webhook_deliveries WHERE id = ?")
    .bind(deliveryId)
    .first<{ id: string; form_id: string; url: string; payload: string; event: string; attempts: number }>()
  if (!row) return

  const form = await getForm(env, row.form_id)
  if (!form) return

  const result = await send(form, row.url, row.id, row.event, row.payload)
  const attempts = row.attempts + 1
  const done = Date.now()

  if (result.ok) {
    await env.DB.prepare(
      `UPDATE webhook_deliveries SET status = 'success', attempts = ?, response_status = ?, error = NULL,
       next_attempt_at = NULL, updated_at = ? WHERE id = ?`
    )
      .bind(attempts, result.status, done, row.id)
      .run()
    return
  }

  const exhausted = attempts >= MAX_ATTEMPTS
  await env.DB.prepare(
    `UPDATE webhook_deliveries SET status = ?, attempts = ?, response_status = ?, error = ?,
     next_attempt_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(
      exhausted ? "failed" : "pending",
      attempts,
      result.status,
      result.error,
      exhausted ? null : done + RETRY_DELAYS_MS[attempts - 1],
      done,
      row.id
    )
    .run()
}

/** Cron entry point: retry everything that is due. */
export async function processDueDeliveries(env: Env): Promise<number> {
  const due = await env.DB.prepare(
    `SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= ?
     ORDER BY next_attempt_at ASC LIMIT 25`
  )
    .bind(Date.now())
    .all<{ id: string }>()
  await Promise.all(due.results.map((r) => attemptDelivery(env, r.id)))
  return due.results.length
}

/** Manual resend from the dashboard: reset and try right away. */
export async function resendDelivery(env: Env, deliveryId: string): Promise<boolean> {
  const now = Date.now()
  const res = await env.DB.prepare(
    `UPDATE webhook_deliveries SET status = 'pending', attempts = 0, next_attempt_at = ?, error = NULL, updated_at = ?
     WHERE id = ?`
  )
    .bind(now, now, deliveryId)
    .run()
  if (res.meta.changes === 0) return false
  await attemptDelivery(env, deliveryId)
  return true
}

/** Sends a sample payload immediately and logs it. No retries. */
export async function sendTestWebhook(env: Env, form: FormConfig): Promise<SendResult> {
  if (!form.webhook_url) return { ok: false, status: null, error: "No webhook URL configured" }
  const now = Date.now()
  const sample: Submission = {
    seq: 0,
    id: "sub_test",
    form_id: form.id,
    created_at: now,
    data: Object.fromEntries(
      (form.fields.length ? form.fields : [{ name: "email" }, { name: "message" }]).map((f) => [f.name, "test"])
    ),
    meta: { country: "US", device: "desktop", referrer: "example.com" },
  }
  const id = newId("whd")
  const body = JSON.stringify(buildPayload(form, sample, "test"))
  const result = await send(form, form.webhook_url, id, "test", body)
  await env.DB.prepare(
    `INSERT INTO webhook_deliveries (id, form_id, submission_id, event, url, payload, status, attempts, response_status, error, created_at, updated_at)
     VALUES (?, ?, NULL, 'test', ?, ?, ?, 1, ?, ?, ?, ?)`
  )
    .bind(id, form.id, form.webhook_url, body, result.ok ? "success" : "failed", result.status, result.error, now, now)
    .run()
  return result
}
