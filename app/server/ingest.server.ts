import { deviceFromUserAgent } from "#/lib/device"
import { validateSubmission, type FieldError } from "#/lib/schema"
import { getFormCached, type FormConfig, type Submission } from "./forms.server"
import { attemptDelivery, deliveryInsert } from "./webhook.server"
import { parseBody } from "./body.server"
import { isBlocked, maybeAutoBlock } from "./blocks.server"
import { verifyTurnstile } from "./turnstile.server"
import { json, newId, serverSecret, sha256Hex, clientIp } from "./util.server"


const BEACON_LIMIT_PER_MIN = 300
const lastDropNote = new Map<string, number>() // per running instance: at most one marker check per form per minute

type EventType = "view" | "start" | "submit" | "reject" | "spam" | "blocked"

// ---- request helpers ---------------------------------------------------------

function requestOrigin(request: Request): string | null {
  const origin = request.headers.get("origin")
  if (origin && origin !== "null") return origin
  const referer = request.headers.get("referer")
  if (referer) {
    try {
      return new URL(referer).origin
    } catch {}
  }
  return null
}

/** Entries: "https://example.com", "example.com" or "*.example.com". */
export function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (allowed.length === 0) return true
  if (!origin) return false
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  return allowed.some((entry) => {
    const e = entry.trim().toLowerCase()
    if (!e) return false
    if (e.includes("://")) return url.origin.toLowerCase() === e.replace(/\/+$/, "")
    if (e.startsWith("*.")) {
      const suffix = e.slice(1)
      return url.hostname.toLowerCase().endsWith(suffix) && url.hostname.length > suffix.length
    }
    return url.hostname.toLowerCase() === e || url.host.toLowerCase() === e
  })
}

function hostOf(origin: string | null): string | null {
  if (!origin) return null
  try {
    return new URL(origin).host
  } catch {
    return null
  }
}

function corsHeaders(origin: string | null, form: FormConfig | null): Headers {
  const h = new Headers({
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Accept, X-Requested-With",
    "access-control-max-age": "86400",
    vary: "Origin",
  })
  const allowlist = form?.allowed_origins ?? []
  if (allowlist.length === 0) h.set("access-control-allow-origin", "*")
  else if (origin && originAllowed(origin, allowlist)) h.set("access-control-allow-origin", origin)
  return h
}

type Identities = { visitor: string; ip: string }

/**
 * Two salted, daily-rotating hashes, never the raw IP:
 * `visitor` (IP + user agent) counts unique people; `ip` (IP only) drives rate limits and de-duplication,
 * so rotating the User-Agent header does not help a flooder.
 */
async function identities(request: Request, env: Env): Promise<Identities> {
  const day = new Date().toISOString().slice(0, 10)
  const ua = request.headers.get("user-agent") ?? ""
  const ip = clientIp(request)
  const secret = serverSecret(env)
  return {
    visitor: (await sha256Hex(`${secret}:${day}:${ip}:${ua}`)).slice(0, 20),
    ip: (await sha256Hex(`${secret}:${day}:${ip}`)).slice(0, 20),
  }
}

function recordEvent(
  env: Env,
  formId: string,
  type: EventType,
  request: Request,
  ids: Identities,
  detail?: unknown
) {
  const origin = requestOrigin(request)
  return env.DB.prepare(
    `INSERT INTO events (form_id, type, detail, country, referrer, device, visitor, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    formId,
    type,
    detail === undefined ? null : JSON.stringify(detail),
    (request as Request & { cf?: { country?: string } }).cf?.country ?? null,
    hostOf(origin),
    deviceFromUserAgent(request.headers.get("user-agent")),
    ids.visitor,
    ids.ip,
    Date.now()
  )
}

function wantsJson(request: Request): boolean {
  const accept = request.headers.get("accept") ?? ""
  const type = request.headers.get("content-type") ?? ""
  return (
    type.includes("application/json") ||
    request.headers.get("x-requested-with") === "XMLHttpRequest" ||
    (accept.includes("application/json") && !accept.includes("text/html"))
  )
}

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>:root{color-scheme:light dark}body{font-family:Inter,ui-sans-serif,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;background:#fff;color:#0a0a0a}
@media(prefers-color-scheme:dark){body{background:#0a0a0a;color:#fafafa}.card{border-color:#262626!important}a{color:#fafafa}}
.card{max-width:420px;width:100%;border:1px solid #e5e5e5;border-radius:12px;padding:28px}h1{font-size:20px;margin:0 0 8px}p,li{color:#737373;font-size:14px;line-height:1.5}ul{padding-left:18px}a{color:#0a0a0a}</style></head>
<body><div class="card">${body}</div></body></html>`
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-security-policy": "frame-ancestors 'none'",
      "cache-control": "no-store",
    },
  })
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

// ---- public handlers ---------------------------------------------------------

function fail(
  request: Request,
  cors: Headers,
  status: number,
  message: string,
  errors?: FieldError[]
): Response {
  if (wantsJson(request)) {
    return json({ ok: false, error: message, errors: errors ?? [] }, { status, headers: cors })
  }
  const list = errors?.length ? `<ul>${errors.map((e) => `<li>${escapeHtml(e.message)}</li>`).join("")}</ul>` : ""
  return page(
    "Submission failed",
    `<h1>Submission failed</h1><p>${escapeHtml(message)}</p>${list}<p><a href="javascript:history.back()">&larr; Go back</a></p>`,
    status
  )
}

export async function handleSubmit(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  formId: string
): Promise<Response> {
  const origin = requestOrigin(request)

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin, await getFormCached(env, formId)) })
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed. POST your data to this URL." }, { status: 405, headers: corsHeaders(origin, null) })
  }

  const form = await getFormCached(env, formId)
  const cors = corsHeaders(origin, form)

  // Blocked addresses are refused before anything else and without touching the database:
  // the list is held in memory, so a flood from a blocked address costs nothing.
  const address = clientIp(request)
  if (await isBlocked(env, address)) return fail(request, cors, 403, "Submissions from your address are blocked.")

  if (!form) return fail(request, cors, 404, "Form not found")

  const ids = await identities(request, env)

  // One read answers both limits: the form-wide backstop (bounds how many rows a flood can write, even when
  // every request looks like a new visitor) and the per-visitor limit.
  let recentMine = 0
  if (form.global_limit_per_min > 0 || form.rate_limit_per_min > 0) {
    const recent = await env.DB.prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(ip_hash = ?), 0) AS mine FROM events
       WHERE form_id = ? AND created_at > ? AND type IN ('submit', 'reject', 'spam', 'blocked')`
    )
      .bind(ids.ip, form.id, Date.now() - 60_000)
      .first<{ total: number; mine: number }>()
    recentMine = recent?.mine ?? 0
    if (form.global_limit_per_min > 0 && (recent?.total ?? 0) >= form.global_limit_per_min) {
      cors.set("retry-after", "30")
      return fail(request, cors, 429, "This form is receiving too many submissions right now. Please try again shortly.")
    }
  }

  const block = (reason: string) => {
    ctx.waitUntil(recordEvent(env, form.id, "blocked", request, ids, { reason }).run())
  }

  if (!form.enabled) {
    block("form_disabled")
    return fail(request, cors, 403, "This form is not accepting submissions")
  }
  if (!originAllowed(origin, form.allowed_origins)) {
    block("origin_not_allowed")
    return fail(request, cors, 403, "Submissions from this origin are not allowed")
  }

  if (form.rate_limit_per_min > 0 && recentMine >= form.rate_limit_per_min) {
    // Log only the first overflow of the window so a flood cannot flood our own table.
    if (recentMine === form.rate_limit_per_min) block("rate_limited")
    cors.set("retry-after", "60")
    return fail(request, cors, 429, "Too many submissions. Please try again in a minute.")
  }

  const body = await parseBody(request)
  if (!body.ok) return fail(request, cors, body.status, body.message)

  // The Turnstile widget adds this field. It is never part of the submitted data.
  const turnstileToken = body.data["cf-turnstile-response"]
  delete body.data["cf-turnstile-response"]

  const success = async (id?: string) => {
    if (wantsJson(request)) return json({ ok: true, id: id ?? null, message: "Submission received" }, { status: 200, headers: cors })
    if (form.redirect_url) {
      const headers = new Headers(cors)
      headers.set("location", form.redirect_url)
      return new Response(null, { status: 303, headers })
    }
    return page(
      "Thank you",
      `<h1>Thank you!</h1><p>Your submission has been received.</p><p><a href="javascript:history.back()">&larr; Go back</a></p>`
    )
  }

  // Honeypot: bots fill hidden fields. Pretend it worked, store nothing. The event is written before the
  // response (not in the background) so the automatic-block count below can see it.
  const trap = form.honeypot_field ? body.data[form.honeypot_field] : undefined
  if (trap !== undefined && String(trap).trim() !== "") {
    await recordEvent(env, form.id, "spam", request, ids, { reason: "honeypot" }).run()
    await maybeAutoBlock(env, form, "honeypot", address, ids.ip)
    return success()
  }

  // Cloudflare Turnstile (optional, per form): proves a real browser solved the challenge.
  if (form.turnstile_enabled && form.turnstile_secret) {
    const check = await verifyTurnstile(form.turnstile_secret, turnstileToken)
    if (!check.ok && check.reason === "invalid") {
      await recordEvent(env, form.id, "blocked", request, ids, { reason: "turnstile_failed" }).run()
      await maybeAutoBlock(env, form, "turnstile", address, ids.ip)
      return fail(request, cors, 403, "Verification failed. Please reload the page and try again.")
    }
    if (!check.ok) {
      // Our secret is wrong or Cloudflare is unreachable: not the visitor's fault, so never counted against them.
      block(check.reason === "misconfigured" ? "turnstile_misconfigured" : "turnstile_unavailable")
      return fail(request, cors, 503, "Verification is temporarily unavailable. Please try again shortly.")
    }
  }

  // Without enforcement the schema is only documentation: everything is accepted.
  const result = validateSubmission(form.schema_enforced ? form.fields : [], form.unknown_fields, body.data)
  const errors: FieldError[] = result.ok ? [] : [...result.errors]
  for (const name of body.fileFields) {
    errors.push({ field: name, code: "file_not_supported", message: `File uploads are not supported (${name})` })
  }

  if (errors.length > 0 || !result.ok) {
    ctx.waitUntil(recordEvent(env, form.id, "reject", request, ids, errors).run())
    return fail(request, cors, 422, "Some fields are missing or invalid", errors)
  }

  const submission: Submission = {
    seq: 0,
    id: newId("sub"),
    form_id: form.id,
    data: result.data,
    meta: {
      country: (request as Request & { cf?: { country?: string } }).cf?.country ?? null,
      device: deviceFromUserAgent(request.headers.get("user-agent")),
      referrer: hostOf(origin),
    },
    created_at: Date.now(),
  }

  const results = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO submissions (id, form_id, data, meta, created_at) VALUES (?, ?, ?, ?, ?) RETURNING seq"
    ).bind(submission.id, form.id, JSON.stringify(submission.data), JSON.stringify(submission.meta), submission.created_at),
    recordEvent(env, form.id, "submit", request, ids),
  ])
  submission.seq = (results[0].results[0] as { seq: number }).seq

  if (form.webhook_enabled && form.webhook_url) {
    // The delivery row is written before we answer so a crash cannot lose it;
    // the actual HTTP call happens after the response. The cron retries failures.
    const delivery = deliveryInsert(env, form, submission)
    await delivery.stmt.run()
    ctx.waitUntil(attemptDelivery(env, delivery.id))
  }

  return success(submission.id)
}

async function noteDroppedViews(env: Env, formId: string, request: Request, ids: Identities) {
  const now = Date.now()
  if (now - (lastDropNote.get(formId) ?? 0) < 60_000) return
  lastDropNote.set(formId, now)
  const marker = await env.DB.prepare(
    "SELECT 1 FROM events WHERE form_id = ? AND type = 'blocked' AND created_at > ? AND json_extract(detail, '$.reason') = 'views_capped' LIMIT 1"
  )
    .bind(formId, now - 60_000)
    .first()
  if (!marker) await recordEvent(env, formId, "blocked", request, ids, { reason: "views_capped" }).run()
}

/** POST /f/:id/view and /f/:id/start — fired by the tracking snippet. */
export async function handleBeacon(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  formId: string,
  type: "view" | "start"
): Promise<Response> {
  const form = await getFormCached(env, formId)
  const origin = requestOrigin(request)
  const cors = corsHeaders(origin, form)
  const ignore = () => new Response(null, { status: 204, headers: cors }) // beacons never reveal why they were ignored
  if (request.method === "OPTIONS") return ignore()
  if (!form || !originAllowed(origin, form.allowed_origins) || request.method !== "POST") return ignore()

  // A real browser always sends an Origin (or at least a Referer) with a beacon. curl and most scripts do not,
  // and neither do they pretend to be a browser, so these two checks catch most view spam
  // before it can touch the database.
  if (!origin) return ignore()
  if (deviceFromUserAgent(request.headers.get("user-agent")) === "bot") return ignore()
  if (await isBlocked(env, clientIp(request))) return ignore()

  // Form-wide backstop for beacons too: an attacker cannot grow the events table without limit.
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM events WHERE form_id = ? AND type IN ('view', 'start') AND created_at > ?"
  )
    .bind(form.id, Date.now() - 60_000)
    .first<{ c: number }>()
  if ((recent?.c ?? 0) >= BEACON_LIMIT_PER_MIN) {
    // Real views are being dropped: leave one marker per minute so Analytics can warn that the numbers are low.
    ctx.waitUntil(noteDroppedViews(env, form.id, request, await identities(request, env)))
    return ignore()
  }

  const ids = await identities(request, env)
  // One view / start per IP per 30 minutes is plenty and keeps the table small. The check uses the IP-only hash,
  // so changing the User-Agent does not create a second view.
  const seen = await env.DB.prepare(
    "SELECT 1 FROM events WHERE form_id = ? AND type = ? AND ip_hash = ? AND created_at > ? LIMIT 1"
  )
    .bind(form.id, type, ids.ip, Date.now() - 30 * 60_000)
    .first()
  if (!seen) ctx.waitUntil(recordEvent(env, form.id, type, request, ids).run())
  return new Response(null, { status: 204, headers: cors })
}

export function trackerScript(request: Request, formId: string): Response {
  const base = new URL(request.url).origin
  const id = JSON.stringify(formId)
  const js = `(function(){var B=${JSON.stringify(base)},I=${id},sent={};
function ping(t){if(sent[t])return;sent[t]=1;try{var u=B+"/f/"+I+"/"+t;if(navigator.sendBeacon)navigator.sendBeacon(u,"");else fetch(u,{method:"POST",mode:"no-cors",keepalive:true})}catch(e){}}
function mine(f){return f&&(f.hasAttribute("data-formbucket")||(f.action||"").indexOf("/f/"+I)>-1)}
ping("view");
document.addEventListener("focusin",function(e){var f=e.target&&e.target.closest&&e.target.closest("form");if(mine(f))ping("start")});
})();`
  return new Response(js, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  })
}
