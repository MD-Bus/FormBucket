import { getForm, parseSubmission, publicSubmission, type SubmissionRow } from "./forms.server"
import { json, newId, randomString, safeJsonParse, sha256Hex } from "./util.server"

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const MAX_WAIT_SECONDS = 25
const POLL_INTERVAL_MS = 1500

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, X-API-Key",
  "access-control-max-age": "86400",
}

function reply(body: unknown, status = 200): Response {
  return json(body, { status, headers: { ...CORS, "cache-control": "no-store" } })
}

function apiError(status: number, code: string, message: string): Response {
  return reply({ error: { code, message } }, status)
}

// ---- API keys ----------------------------------------------------------------

export async function createApiKey(env: Env, name: string, formId: string | null) {
  const secret = `fbk_${randomString(40)}`
  const id = newId("key")
  await env.DB.prepare(
    "INSERT INTO api_keys (id, name, prefix, key_hash, form_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(id, name, secret.slice(0, 8), await sha256Hex(secret), formId, Date.now())
    .run()
  return { id, secret }
}

type KeyRow = { id: string; form_id: string | null; last_used_at: number | null }

async function authenticate(request: Request, env: Env): Promise<KeyRow | null> {
  const header = request.headers.get("authorization") ?? ""
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : (request.headers.get("x-api-key") ?? "").trim()
  if (!token.startsWith("fbk_")) return null
  const key = await env.DB.prepare("SELECT id, form_id, last_used_at FROM api_keys WHERE key_hash = ?")
    .bind(await sha256Hex(token))
    .first<KeyRow>()
  return key
}

// ---- helpers -------------------------------------------------------------------

function parseCursor(value: string | null): number | null {
  if (value === null || value === "") return 0
  if (!/^\d{1,15}$/.test(value)) return null
  return Number(value)
}

function parseLimit(value: string | null): number {
  const n = Number(value)
  if (!value || !Number.isFinite(n)) return DEFAULT_LIMIT
  return Math.min(Math.max(Math.floor(n), 1), MAX_LIMIT)
}

async function maxSeq(env: Env, formId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM submissions WHERE form_id = ?")
    .bind(formId)
    .first<{ m: number }>()
  return row?.m ?? 0
}

async function readAfter(env: Env, formId: string, after: number, limit: number, since: number | null) {
  const res = await env.DB.prepare(
    `SELECT seq, id, form_id, data, meta, created_at FROM submissions
     WHERE form_id = ? AND seq > ? AND created_at >= ? ORDER BY seq ASC LIMIT ?`
  )
    .bind(formId, after, since ?? 0, limit + 1)
    .all<SubmissionRow>()
  const rows = res.results
  const hasMore = rows.length > limit
  return { rows: hasMore ? rows.slice(0, limit) : rows, hasMore }
}

/** Reads new rows, optionally holding the request open (long polling) until some arrive. */
async function readWithWait(
  env: Env,
  formId: string,
  after: number,
  limit: number,
  since: number | null,
  waitSeconds: number
) {
  const deadline = Date.now() + waitSeconds * 1000
  for (;;) {
    const result = await readAfter(env, formId, after, limit, since)
    if (result.rows.length > 0 || Date.now() + POLL_INTERVAL_MS >= deadline) return result
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
}

function envelope(rows: SubmissionRow[], hasMore: boolean, fallbackCursor: number) {
  const data = rows.map((r) => publicSubmission(parseSubmission(r)))
  const cursor = rows.length > 0 ? rows[rows.length - 1].seq : fallbackCursor
  return { data, cursor: String(cursor), has_more: hasMore }
}

// ---- router --------------------------------------------------------------------

export async function handleApi(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })

  const key = await authenticate(request, env)
  if (!key) return apiError(401, "unauthorized", "Missing or invalid API key. Send it as `Authorization: Bearer fbk_...`.")

  // Fire-and-forget would need ctx; a throttled write is fine here.
  if (!key.last_used_at || Date.now() - key.last_used_at > 60_000) {
    await env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(Date.now(), key.id).run()
  }

  const url = new URL(request.url)
  const parts = url.pathname.replace(/^\/api\/v1\/?/, "").split("/").filter(Boolean).map(decodeURIComponent)
  const method = request.method

  // GET /forms
  if (parts[0] === "forms" && parts.length === 1) {
    if (method !== "GET") return apiError(405, "method_not_allowed", "Use GET")
    const rows = await env.DB.prepare(
      `SELECT f.id, f.name, f.enabled, f.schema_enforced, f.fields, f.unknown_fields, f.created_at,
        (SELECT COUNT(*) FROM submissions s WHERE s.form_id = f.id) AS submissions
       FROM forms f ${key.form_id ? "WHERE f.id = ?" : ""} ORDER BY f.created_at ASC`
    )
      .bind(...(key.form_id ? [key.form_id] : []))
      .all<{ id: string; name: string; enabled: number; schema_enforced: number; fields: string; unknown_fields: string; created_at: number; submissions: number }>()
    return reply({
      data: rows.results.map((f) => ({
        id: f.id,
        name: f.name,
        enabled: f.enabled === 1,
        schema_enforced: f.schema_enforced === 1,
        unknown_fields: f.unknown_fields,
        fields: safeJsonParse(f.fields, []),
        submissions: f.submissions,
        created_at: new Date(f.created_at).toISOString(),
      })),
    })
  }

  if (parts[0] !== "forms" || parts.length < 2) return apiError(404, "not_found", "Unknown endpoint")
  const formId = parts[1]
  if (key.form_id && key.form_id !== formId) return apiError(403, "forbidden", "This API key cannot access that form")
  const form = await getForm(env, formId)
  if (!form) return apiError(404, "form_not_found", "Form not found")

  const rest = parts.slice(2)

  // GET /forms/:id
  if (rest.length === 0) {
    if (method !== "GET") return apiError(405, "method_not_allowed", "Use GET")
    return reply({
      id: form.id,
      name: form.name,
      enabled: form.enabled,
      schema_enforced: form.schema_enforced,
      unknown_fields: form.unknown_fields,
      fields: form.fields,
      latest_cursor: String(await maxSeq(env, form.id)),
    })
  }

  if (rest[0] === "submissions") {
    if (method !== "GET") return apiError(405, "method_not_allowed", "Use GET")

    // GET /forms/:id/submissions/:submissionId
    if (rest.length === 2) {
      const row = await env.DB.prepare(
        "SELECT seq, id, form_id, data, meta, created_at FROM submissions WHERE form_id = ? AND id = ?"
      )
        .bind(form.id, rest[1])
        .first<SubmissionRow>()
      if (!row) return apiError(404, "not_found", "Submission not found")
      return reply(publicSubmission(parseSubmission(row)))
    }

    // GET /forms/:id/submissions?after=&limit=&since=&wait=
    const after = parseCursor(url.searchParams.get("after"))
    if (after === null) return apiError(400, "invalid_cursor", "`after` must be a cursor returned by this API")
    const sinceParam = url.searchParams.get("since")
    const since = sinceParam ? Date.parse(sinceParam) : null
    if (sinceParam && Number.isNaN(since)) return apiError(400, "invalid_since", "`since` must be an ISO 8601 date")
    const wait = Math.min(Math.max(Number(url.searchParams.get("wait") ?? 0) || 0, 0), MAX_WAIT_SECONDS)
    const { rows, hasMore } = await readWithWait(env, form.id, after, parseLimit(url.searchParams.get("limit")), since, wait)
    return reply(envelope(rows, hasMore, after))
  }

  if (rest[0] === "consumers") {
    // GET /forms/:id/consumers
    if (rest.length === 1) {
      if (method !== "GET") return apiError(405, "method_not_allowed", "Use GET")
      const res = await env.DB.prepare(
        "SELECT name, cursor, created_at, last_pull_at, last_ack_at FROM consumers WHERE form_id = ? ORDER BY created_at ASC"
      )
        .bind(form.id)
        .all()
      return reply({ data: res.results.map((c) => ({ ...c, cursor: String(c.cursor) })) })
    }

    const name = rest[1]
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) {
      return apiError(400, "invalid_consumer", "Consumer names may contain letters, numbers, `_`, `-` and `.` (max 64)")
    }
    const action = rest[2]

    if (!action) {
      if (method === "DELETE") {
        await env.DB.prepare("DELETE FROM consumers WHERE form_id = ? AND name = ?").bind(form.id, name).run()
        return reply({ ok: true })
      }
      if (method !== "GET") return apiError(405, "method_not_allowed", "Use GET or DELETE")
      const c = await env.DB.prepare("SELECT name, cursor, created_at, last_pull_at, last_ack_at FROM consumers WHERE form_id = ? AND name = ?")
        .bind(form.id, name)
        .first<{ cursor: number }>()
      if (!c) return apiError(404, "consumer_not_found", "Consumer not found. It is created on its first pull.")
      return reply({ ...c, cursor: String(c.cursor), latest_cursor: String(await maxSeq(env, form.id)) })
    }

    if (action === "pull") {
      if (method !== "GET" && method !== "POST") return apiError(405, "method_not_allowed", "Use GET or POST")
      const from = url.searchParams.get("from") === "latest" ? "latest" : "beginning"
      const now = Date.now()
      // Create on first use: "latest" starts at the current end, "beginning" replays everything.
      const initial = from === "latest" ? await maxSeq(env, form.id) : 0
      await env.DB.prepare("INSERT OR IGNORE INTO consumers (form_id, name, cursor, created_at) VALUES (?, ?, ?, ?)")
        .bind(form.id, name, initial, now)
        .run()
      const consumer = (await env.DB.prepare("SELECT cursor FROM consumers WHERE form_id = ? AND name = ?")
        .bind(form.id, name)
        .first<{ cursor: number }>())!

      const wait = Math.min(Math.max(Number(url.searchParams.get("wait") ?? 0) || 0, 0), MAX_WAIT_SECONDS)
      const { rows, hasMore } = await readWithWait(env, form.id, consumer.cursor, parseLimit(url.searchParams.get("limit")), null, wait)
      const body = envelope(rows, hasMore, consumer.cursor)

      const autoAck = ["1", "true", "yes"].includes((url.searchParams.get("ack") ?? "").toLowerCase())
      let acked = consumer.cursor
      if (autoAck && rows.length > 0) {
        acked = rows[rows.length - 1].seq
        await env.DB.prepare(
          "UPDATE consumers SET cursor = MAX(cursor, ?), last_pull_at = ?, last_ack_at = ? WHERE form_id = ? AND name = ?"
        )
          .bind(acked, now, now, form.id, name)
          .run()
      } else {
        await env.DB.prepare("UPDATE consumers SET last_pull_at = ? WHERE form_id = ? AND name = ?").bind(now, form.id, name).run()
      }
      return reply({ ...body, consumer: { name, acked_cursor: String(acked) } })
    }

    if (action === "ack") {
      if (method !== "POST") return apiError(405, "method_not_allowed", "Use POST")
      let raw: unknown = url.searchParams.get("cursor")
      if (raw === null) raw = (safeJsonParse<{ cursor?: unknown }>(await request.text(), {})).cursor
      const cursor = parseCursor(raw === undefined || raw === null ? null : String(raw))
      if (cursor === null || raw === undefined || raw === null) {
        return apiError(400, "invalid_cursor", "Send `{ \"cursor\": \"<cursor from the last pull>\" }`")
      }
      if (cursor > (await maxSeq(env, form.id))) return apiError(400, "invalid_cursor", "Cursor is ahead of the latest submission")
      const now = Date.now()
      const res = await env.DB.prepare(
        "UPDATE consumers SET cursor = MAX(cursor, ?), last_ack_at = ? WHERE form_id = ? AND name = ?"
      )
        .bind(cursor, now, form.id, name)
        .run()
      if (res.meta.changes === 0) return apiError(404, "consumer_not_found", "Pull first to create the consumer")
      const c = await env.DB.prepare("SELECT cursor FROM consumers WHERE form_id = ? AND name = ?").bind(form.id, name).first<{ cursor: number }>()
      return reply({ ok: true, name, acked_cursor: String(c?.cursor ?? cursor) })
    }

    if (action === "reset") {
      if (method !== "POST") return apiError(405, "method_not_allowed", "Use POST")
      const body = safeJsonParse<{ cursor?: unknown; back?: unknown }>(await request.text(), {})
      if (body.cursor !== undefined && body.back !== undefined) {
        return apiError(400, "invalid_reset", "Send either `cursor` or `back`, not both")
      }
      const latest = await maxSeq(env, form.id)
      let target: number

      if (body.back !== undefined) {
        // "Replay the last N entries": the cursor is placed just before the Nth newest entry of THIS form.
        // The counter is shared by all forms and has gaps, so it cannot simply be `latest - N`.
        const n = Number(body.back)
        if (!Number.isInteger(n) || n < 1 || n > 1_000_000) return apiError(400, "invalid_back", "`back` must be a whole number of entries between 1 and 1000000")
        const before = await env.DB.prepare("SELECT seq FROM submissions WHERE form_id = ? ORDER BY seq DESC LIMIT 1 OFFSET ?")
          .bind(form.id, n)
          .first<{ seq: number }>()
        target = before?.seq ?? 0
      } else if (body.cursor === "latest") target = latest
      else if (body.cursor === undefined || body.cursor === "beginning" || body.cursor === 0 || body.cursor === "0") target = 0
      else {
        const parsed = parseCursor(String(body.cursor))
        if (parsed === null) return apiError(400, "invalid_cursor", "`cursor` must be \"beginning\", \"latest\" or a cursor value")
        // A cursor past the newest entry would silently skip every submission that arrives before the counter catches up.
        if (parsed > latest) return apiError(400, "invalid_cursor", `Cursor is ahead of the latest submission (latest is ${latest})`)
        target = parsed
      }
      await env.DB.prepare(
        `INSERT INTO consumers (form_id, name, cursor, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(form_id, name) DO UPDATE SET cursor = excluded.cursor`
      )
        .bind(form.id, name, target, Date.now())
        .run()
      return reply({ ok: true, name, acked_cursor: String(target), latest_cursor: String(latest) })
    }
  }

  return apiError(404, "not_found", "Unknown endpoint")
}
