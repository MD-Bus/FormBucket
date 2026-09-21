import type { FieldDef, UnknownFieldsMode } from "#/lib/schema"
import { safeJsonParse } from "./util.server"
import { memo } from "./request-cache.server"

export type FormRow = {
  id: string
  name: string
  description: string
  enabled: number
  schema_enforced: number
  fields: string
  unknown_fields: UnknownFieldsMode
  allowed_origins: string
  redirect_url: string | null
  honeypot_field: string
  rate_limit_per_min: number
  global_limit_per_min: number
  turnstile_enabled: number
  turnstile_site_key: string | null
  turnstile_secret: string | null
  honeypot_block_after: number
  honeypot_block_hours: number
  turnstile_block_after: number
  turnstile_block_hours: number
  webhook_enabled: number
  webhook_url: string | null
  webhook_secret: string | null
  webhook_headers: string
  created_at: number
  updated_at: number
}

export type FormConfig = Omit<
  FormRow,
  "fields" | "allowed_origins" | "webhook_headers" | "enabled" | "webhook_enabled" | "schema_enforced" | "turnstile_enabled"
> & {
  enabled: boolean
  schema_enforced: boolean
  turnstile_enabled: boolean
  webhook_enabled: boolean
  fields: FieldDef[]
  allowed_origins: string[]
  webhook_headers: Record<string, string>
}

export function parseForm(row: FormRow): FormConfig {
  return {
    ...row,
    enabled: row.enabled === 1,
    schema_enforced: row.schema_enforced === 1,
    turnstile_enabled: row.turnstile_enabled === 1,
    webhook_enabled: row.webhook_enabled === 1,
    fields: safeJsonParse<FieldDef[]>(row.fields, []),
    allowed_origins: safeJsonParse<string[]>(row.allowed_origins, []),
    webhook_headers: safeJsonParse<Record<string, string>>(row.webhook_headers, {}),
  }
}

async function loadForm(env: Env, id: string): Promise<FormConfig | null> {
  const row = await env.DB.prepare("SELECT * FROM forms WHERE id = ?").bind(id).first<FormRow>()
  return row ? parseForm(row) : null
}

export function getForm(env: Env, id: string): Promise<FormConfig | null> {
  // The form layout and the page both need the row: share one lookup per GET request.
  return memo(env, `form:${id}`, () => loadForm(env, id), { onlyWhenReadOnly: true })
}

// The public endpoint reads the form on every submission. Keeping it in memory for a few seconds spares
// D1 a round trip on the hot path. Trade-off: a settings change (form disabled, origins, Turnstile, limits)
// can take up to FORM_CACHE_TTL_MS to reach every running instance. Missing forms are never cached, so a
// form you just created works immediately.
const FORM_CACHE_TTL_MS = 10_000
const formCache = new Map<string, { at: number; form: FormConfig }>()

export async function getFormCached(env: Env, id: string): Promise<FormConfig | null> {
  const hit = formCache.get(id)
  if (hit && Date.now() - hit.at < FORM_CACHE_TTL_MS) return hit.form
  const form = await loadForm(env, id)
  if (!form) {
    formCache.delete(id)
    return null
  }
  if (formCache.size >= 500) formCache.clear()
  formCache.set(id, { at: Date.now(), form })
  return form
}

export type SubmissionRow = {
  seq: number
  id: string
  form_id: string
  data: string
  meta: string
  created_at: number
}

export type SubmissionMeta = {
  country?: string | null
  device?: string
  referrer?: string | null
  user_agent?: string | null
}

export type Submission = {
  seq: number
  id: string
  form_id: string
  data: Record<string, unknown>
  meta: SubmissionMeta
  created_at: number
}

export function parseSubmission(row: SubmissionRow): Submission {
  return {
    ...row,
    data: safeJsonParse<Record<string, unknown>>(row.data, {}),
    meta: safeJsonParse<SubmissionMeta>(row.meta, {}),
  }
}

/** Public shape returned by the API and webhooks. */
export function publicSubmission(s: Submission) {
  return {
    id: s.id,
    seq: s.seq,
    form_id: s.form_id,
    created_at: new Date(s.created_at).toISOString(),
    data: s.data,
    meta: s.meta,
  }
}

export const RESERVED_FORM_IDS = new Set(["keys", "blocked-ips", "new", "settings", "api", "f", "login", "logout", "setup"])

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
}
