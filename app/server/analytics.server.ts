import type { FieldDef } from "#/lib/schema"
import type { FormConfig } from "./forms.server"

const DAY = 86_400_000

export type Range = 7 | 30 | 90
export function parseRange(value: string | null): Range {
  return value === "7" ? 7 : value === "90" ? 90 : 30
}

const jsonPath = (name: string) => `$."${name.replace(/"/g, "")}"`

export type DimensionRow = { name: string; view: number; submit: number }
export type RejectionRow = { field: string; code: string; count: number }
/** A top-N list plus whether more rows exist (the dashboard then offers "View all"). */
export type Capped<T> = { rows: T[]; more: boolean }

const CARD_LIMIT = 8
const REJECTION_CARD_LIMIT = 10
const PAGE_SIZE = 50

function capped<T>(rows: T[], limit: number): Capped<T> {
  return { rows: rows.slice(0, limit), more: rows.length > limit }
}

export type Analytics = {
  range: Range
  totals: Record<"view" | "start" | "submit" | "reject" | "spam" | "blocked", number>
  visitors: { view: number; submit: number }
  daily: { date: string; label: string; view: number; submit: number; reject: number; blocked: number }[]
  countries: Capped<DimensionRow>
  sites: Capped<DimensionRow>
  devices: Capped<DimensionRow>
  rejections: Capped<RejectionRow>
  blockReasons: { reason: string; count: number }[]
  fields: FieldStat[]
  totalSubmissions: number
}

export type FieldStat = { name: string; type: string; required: boolean; filled: number; total: number; declared: boolean }

function dimensionStmt(
  env: Env,
  formId: string,
  since: number,
  column: "country" | "referrer" | "device",
  limit: number,
  offset = 0,
  q = ""
) {
  return env.DB.prepare(
    `SELECT COALESCE(${column}, 'unknown') AS name,
            SUM(CASE WHEN type = 'view' THEN 1 ELSE 0 END) AS view,
            SUM(CASE WHEN type = 'submit' THEN 1 ELSE 0 END) AS submit
     FROM events WHERE form_id = ? AND created_at >= ? AND type IN ('view', 'submit')
       AND (? = '' OR instr(lower(COALESCE(${column}, 'unknown')), lower(?)) > 0)
     GROUP BY name ORDER BY submit DESC, view DESC, name ASC LIMIT ? OFFSET ?`
  ).bind(formId, since, q, q, limit, offset)
}

function rejectionStmt(env: Env, formId: string, since: number, limit: number, offset = 0, q = "") {
  return env.DB.prepare(
    `SELECT json_extract(j.value, '$.field') AS field, json_extract(j.value, '$.code') AS code, COUNT(*) AS count
     FROM events e, json_each(e.detail) j
     WHERE e.form_id = ? AND e.type = 'reject' AND e.created_at >= ?
       AND (? = '' OR instr(lower(json_extract(j.value, '$.field') || ' ' || json_extract(j.value, '$.code')), lower(?)) > 0)
     GROUP BY field, code ORDER BY count DESC, field ASC, code ASC LIMIT ? OFFSET ?`
  ).bind(formId, since, q, q, limit, offset)
}

async function dimension(env: Env, formId: string, since: number, column: "country" | "referrer" | "device", limit: number, offset = 0, q = "") {
  return (await dimensionStmt(env, formId, since, column, limit, offset, q).all<DimensionRow>()).results
}

async function rejectionRows(env: Env, formId: string, since: number, limit: number, offset = 0, q = "") {
  return (await rejectionStmt(env, formId, since, limit, offset, q).all<RejectionRow>()).results
}

export type BreakdownKind = "countries" | "sites" | "devices" | "rejections"
export const BREAKDOWN_KINDS: BreakdownKind[] = ["countries", "sites", "devices", "rejections"]

/** One page of a full breakdown list, for the "View all" panels. */
export async function getBreakdownPage(env: Env, formId: string, range: Range, kind: BreakdownKind, q: string, offset: number) {
  const since = Date.now() - range * DAY
  const query = q.trim().slice(0, 100)
  const start = Math.max(0, Math.min(offset, 100_000))
  const rows =
    kind === "rejections"
      ? await rejectionRows(env, formId, since, PAGE_SIZE + 1, start, query)
      : await dimension(env, formId, since, kind === "countries" ? "country" : kind === "sites" ? "referrer" : "device", PAGE_SIZE + 1, start, query)
  return { kind, offset: start, hasMore: rows.length > PAGE_SIZE, rows: rows.slice(0, PAGE_SIZE) }
}

const recentKeysStmt = (env: Env, formId: string) =>
  env.DB.prepare("SELECT data FROM submissions WHERE form_id = ? ORDER BY seq DESC LIMIT 200").bind(formId)

function mergeFieldNames(form: FormConfig, recent: { data: string }[]): { name: string; def?: FieldDef }[] {
  const declared = form.fields.map((f) => ({ name: f.name, def: f }))
  const known = new Set(declared.map((d) => d.name))
  const extra = new Set<string>()
  for (const r of recent) {
    try {
      for (const k of Object.keys(JSON.parse(r.data))) if (!known.has(k)) extra.add(k)
    } catch {}
  }
  return [...declared, ...[...extra].sort().slice(0, 40).map((name) => ({ name, def: undefined }))]
}

export async function fieldNamesFor(env: Env, form: FormConfig): Promise<{ name: string; def?: FieldDef }[]> {
  const recent = await recentKeysStmt(env, form.id).all<{ data: string }>()
  return mergeFieldNames(form, recent.results)
}

export async function getAnalytics(env: Env, form: FormConfig, range: Range): Promise<Analytics> {
  const now = Date.now()
  const since = now - range * DAY
  const id = form.id

  // One round trip for everything (each separate query is a network hop to D1).
  const r = await env.DB.batch([
    env.DB.prepare("SELECT type, COUNT(*) AS c FROM events WHERE form_id = ? AND created_at >= ? GROUP BY type").bind(id, since),
    env.DB.prepare(
      `SELECT type, COUNT(DISTINCT visitor) AS c FROM events WHERE form_id = ? AND created_at >= ? AND type IN ('view', 'submit')
       GROUP BY type`
    ).bind(id, since),
    env.DB.prepare(
      `SELECT date(created_at / 1000, 'unixepoch') AS d, type, COUNT(*) AS c FROM events
       WHERE form_id = ? AND created_at >= ? GROUP BY d, type`
    ).bind(id, since),
    rejectionStmt(env, id, since, REJECTION_CARD_LIMIT + 1),
    env.DB.prepare(
      `SELECT json_extract(detail, '$.reason') AS reason, COUNT(*) AS count FROM events
       WHERE form_id = ? AND created_at >= ? AND type IN ('blocked', 'spam') GROUP BY reason ORDER BY count DESC LIMIT 6`
    ).bind(id, since),
    dimensionStmt(env, id, since, "country", CARD_LIMIT + 1),
    dimensionStmt(env, id, since, "referrer", CARD_LIMIT + 1),
    dimensionStmt(env, id, since, "device", CARD_LIMIT + 1),
    env.DB.prepare("SELECT COUNT(*) AS c FROM submissions WHERE form_id = ?").bind(id),
    recentKeysStmt(env, id),
  ])
  const rows = <T,>(i: number) => r[i].results as T[]
  const totalsRes = { results: rows<{ type: string; c: number }>(0) }
  const visitorsRes = { results: rows<{ type: string; c: number }>(1) }
  const dailyRes = { results: rows<{ d: string; type: string; c: number }>(2) }
  const rejectionRes = rows<RejectionRow>(3)
  const blockRes = { results: rows<{ reason: string; count: number }>(4) }
  const countries = rows<DimensionRow>(5)
  const sites = rows<DimensionRow>(6)
  const devices = rows<DimensionRow>(7)
  const totalSubs = rows<{ c: number }>(8)[0]

  const totals = { view: 0, start: 0, submit: 0, reject: 0, spam: 0, blocked: 0 }
  for (const r of totalsRes.results) totals[r.type as keyof typeof totals] = r.c
  const visitors = { view: 0, submit: 0 }
  for (const r of visitorsRes.results) visitors[r.type as "view" | "submit"] = r.c

  // Fill every day of the range so the chart has no gaps.
  const byDay = new Map<string, { view: number; submit: number; reject: number; blocked: number }>()
  for (let i = range - 1; i >= 0; i--) {
    byDay.set(new Date(now - i * DAY).toISOString().slice(0, 10), { view: 0, submit: 0, reject: 0, blocked: 0 })
  }
  for (const r of dailyRes.results) {
    const day = byDay.get(r.d)
    if (!day) continue
    if (r.type === "view") day.view += r.c
    else if (r.type === "submit") day.submit += r.c
    else if (r.type === "reject") day.reject += r.c
    else if (r.type === "blocked" || r.type === "spam") day.blocked += r.c
  }
  const daily = [...byDay.entries()].map(([date, v]) => ({
    date,
    label: new Date(date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    ...v,
  }))

  // Fill rate per field in one pass.
  const names = mergeFieldNames(form, rows<{ data: string }>(9)).slice(0, 60)
  let fields: FieldStat[] = []
  if (names.length > 0) {
    const sums = names
      .map((_, i) => `SUM(CASE WHEN json_extract(data, ?) IS NOT NULL AND json_extract(data, ?) != '' THEN 1 ELSE 0 END) AS f${i}`)
      .join(", ")
    const binds = names.flatMap((n) => [jsonPath(n.name), jsonPath(n.name)])
    const row = await env.DB.prepare(`SELECT COUNT(*) AS total, ${sums} FROM submissions WHERE form_id = ? AND created_at >= ?`)
      .bind(...binds, id, since)
      .first<Record<string, number>>()
    fields = names.map((n, i) => ({
      name: n.name,
      type: n.def?.type ?? "any",
      required: n.def?.required ?? false,
      declared: Boolean(n.def),
      filled: row?.[`f${i}`] ?? 0,
      total: row?.total ?? 0,
    }))
  }

  return {
    range,
    totals,
    visitors,
    daily,
    countries: capped(countries, CARD_LIMIT),
    sites: capped(sites, CARD_LIMIT),
    devices: capped(devices, CARD_LIMIT),
    rejections: capped(rejectionRes, REJECTION_CARD_LIMIT),
    blockReasons: blockRes.results.filter((r) => r.reason),
    fields,
    totalSubmissions: totalSubs?.c ?? 0,
  }
}

export type FieldInsights = {
  name: string
  def: FieldDef | null
  total: number
  filled: number
  distinct: number
  top: { value: string; count: number }[]
  numeric: { min: number; max: number; avg: number } | null
  recent: { value: string; created_at: number }[]
  rejections: { code: string; count: number }[]
}

export async function getFieldInsights(env: Env, form: FormConfig, name: string, range: Range): Promise<FieldInsights> {
  const since = Date.now() - range * DAY
  const path = jsonPath(name)
  const def = form.fields.find((f) => f.name === name) ?? null

  const isNumeric = Boolean(def && (def.type === "number" || def.type === "integer"))
  const statements = [
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN json_extract(data, ?1) IS NOT NULL AND json_extract(data, ?1) != '' THEN 1 ELSE 0 END) AS filled,
        COUNT(DISTINCT json_extract(data, ?1)) AS distinct_values
       FROM submissions WHERE form_id = ?2 AND created_at >= ?3`
    ).bind(path, form.id, since),
    env.DB.prepare(
      `SELECT CAST(json_extract(data, ?1) AS TEXT) AS value, COUNT(*) AS count FROM submissions
       WHERE form_id = ?2 AND created_at >= ?3 AND json_extract(data, ?1) IS NOT NULL AND json_extract(data, ?1) != ''
       GROUP BY value ORDER BY count DESC, value ASC LIMIT 50`
    ).bind(path, form.id, since),
    env.DB.prepare(
      `SELECT CAST(json_extract(data, ?1) AS TEXT) AS value, created_at FROM submissions
       WHERE form_id = ?2 AND json_extract(data, ?1) IS NOT NULL AND json_extract(data, ?1) != ''
       ORDER BY seq DESC LIMIT 8`
    ).bind(path, form.id),
    env.DB.prepare(
      `SELECT json_extract(j.value, '$.code') AS code, COUNT(*) AS count FROM events e, json_each(e.detail) j
       WHERE e.form_id = ?1 AND e.type = 'reject' AND e.created_at >= ?2 AND json_extract(j.value, '$.field') = ?3
       GROUP BY code ORDER BY count DESC`
    ).bind(form.id, since, name),
  ]
  if (isNumeric) {
    statements.push(
      env.DB.prepare(
        `SELECT MIN(json_extract(data, ?1)) AS min, MAX(json_extract(data, ?1)) AS max, AVG(json_extract(data, ?1)) AS avg
         FROM submissions WHERE form_id = ?2 AND created_at >= ?3 AND typeof(json_extract(data, ?1)) IN ('integer', 'real')`
      ).bind(path, form.id, since)
    )
  }
  const res = await env.DB.batch(statements)
  const summary = (res[0].results as { total: number; filled: number; distinct_values: number }[])[0]
  const top = { results: res[1].results as { value: string; count: number }[] }
  const recent = { results: res[2].results as { value: string; created_at: number }[] }
  const rejections = { results: res[3].results as { code: string; count: number }[] }
  const numeric = isNumeric ? (res[4].results as { min: number | null; max: number | null; avg: number | null }[])[0] : null

  return {
    name,
    def,
    total: summary?.total ?? 0,
    filled: summary?.filled ?? 0,
    distinct: summary?.distinct_values ?? 0,
    top: top.results,
    numeric: numeric && numeric.min !== null ? { min: numeric.min!, max: numeric.max!, avg: numeric.avg! } : null,
    recent: recent.results,
    rejections: rejections.results,
  }
}

/** Housekeeping run by the cron trigger. */
export async function pruneOldData(env: Env): Promise<void> {
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare("DELETE FROM events WHERE created_at < ?").bind(now - 180 * DAY),
    env.DB.prepare("DELETE FROM login_attempts WHERE created_at < ?").bind(now - DAY),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM webhook_deliveries WHERE status != 'pending' AND created_at < ?").bind(now - 60 * DAY),
  ])
}
