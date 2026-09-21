import { blockTargetFor, cidrContains, parseCidr, parseIp, type Cidr } from "#/lib/ip"
import { newId } from "./util.server"

export type BlockReason = "manual" | "honeypot" | "turnstile"
export type BlockRow = {
  id: string
  cidr: string
  reason: BlockReason
  form_id: string | null
  note: string | null
  created_at: number
  expires_at: number | null
}

type Active = { cidr: Cidr; expires_at: number | null }

// Blocks are checked on every public request, so the active list lives in memory for a few seconds
// instead of costing a database read each time. A change made in the dashboard reaches other
// running instances within CACHE_TTL_MS.
const CACHE_TTL_MS = 10_000
let cache: { at: number; rows: Active[] } | null = null
let loading: Promise<Active[]> | null = null

export function invalidateBlocks() {
  cache = null
}

async function loadActive(env: Env): Promise<Active[]> {
  const res = await env.DB.prepare("SELECT cidr, expires_at FROM ip_blocks WHERE expires_at IS NULL OR expires_at > ? LIMIT 20000")
    .bind(Date.now())
    .all<{ cidr: string; expires_at: number | null }>()
  const rows: Active[] = []
  for (const r of res.results) {
    const cidr = parseCidr(r.cidr)
    if (cidr) rows.push({ cidr, expires_at: r.expires_at })
  }
  return rows
}

export async function isBlocked(env: Env, rawIp: string): Promise<boolean> {
  const ip = parseIp(rawIp)
  if (!ip) return false
  if (!cache || Date.now() - cache.at > CACHE_TTL_MS) {
    loading ??= loadActive(env).finally(() => (loading = null))
    cache = { at: Date.now(), rows: await loading }
  }
  const now = Date.now()
  return cache.rows.some((r) => (r.expires_at === null || r.expires_at > now) && cidrContains(r.cidr, ip))
}

type AddOptions = {
  cidr: string
  reason: BlockReason
  formId?: string | null
  note?: string | null
  /** null = permanent */
  expiresAt: number | null
  /** "replace" sets exactly this expiry (admin action); "extend" only ever lengthens an existing block. */
  mode: "replace" | "extend"
}

export async function addBlock(env: Env, o: AddOptions): Promise<void> {
  const update =
    o.mode === "replace"
      ? "expires_at = excluded.expires_at, reason = excluded.reason, note = COALESCE(excluded.note, ip_blocks.note)"
      : `expires_at = CASE WHEN ip_blocks.expires_at IS NULL OR excluded.expires_at IS NULL THEN NULL
                          ELSE MAX(ip_blocks.expires_at, excluded.expires_at) END`
  await env.DB.prepare(
    `INSERT INTO ip_blocks (id, cidr, reason, form_id, note, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cidr) DO UPDATE SET ${update}`
  )
    .bind(newId("blk"), o.cidr, o.reason, o.formId ?? null, o.note ?? null, Date.now(), o.expiresAt)
    .run()
  invalidateBlocks() // takes effect immediately in this instance
}

export async function removeBlock(env: Env, id: string): Promise<boolean> {
  const res = await env.DB.prepare("DELETE FROM ip_blocks WHERE id = ?").bind(id).run()
  invalidateBlocks()
  return res.meta.changes > 0
}

const PAGE_SIZE = 50

/** Active blocks, newest first, optionally filtered by text. */
export async function listBlocks(env: Env, q: string, page: number) {
  const query = q.trim().slice(0, 100)
  const offset = Math.max(0, page) * PAGE_SIZE
  const now = Date.now()
  const where = `(expires_at IS NULL OR expires_at > ?1) AND (?2 = '' OR instr(lower(cidr || ' ' || reason || ' ' || COALESCE(note, '') || ' ' || COALESCE(form_id, '')), lower(?2)) > 0)`
  const [rows, count] = await env.DB.batch([
    env.DB.prepare(`SELECT id, cidr, reason, form_id, note, created_at, expires_at FROM ip_blocks WHERE ${where} ORDER BY created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`).bind(now, query),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM ip_blocks WHERE ${where}`).bind(now, query),
  ])
  return {
    rows: rows.results as BlockRow[],
    total: (count.results[0] as { c: number }).c,
    page: Math.max(0, page),
    pageSize: PAGE_SIZE,
  }
}

export async function pruneExpiredBlocks(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM ip_blocks WHERE expires_at IS NOT NULL AND expires_at < ?").bind(Date.now()).run()
  invalidateBlocks()
}

export type AbuseKind = "honeypot" | "turnstile"

/**
 * Called right after an abusive request was recorded. If this visitor reached the form's threshold
 * within the last hour, the address is blocked for the configured time.
 */
export async function maybeAutoBlock(
  env: Env,
  form: { id: string; honeypot_block_after: number; honeypot_block_hours: number; turnstile_block_after: number; turnstile_block_hours: number },
  kind: AbuseKind,
  rawIp: string,
  ipHash: string
): Promise<boolean> {
  const after = kind === "honeypot" ? form.honeypot_block_after : form.turnstile_block_after
  const hours = kind === "honeypot" ? form.honeypot_block_hours : form.turnstile_block_hours
  if (after <= 0) return false
  const target = blockTargetFor(rawIp)
  if (!target) return false

  const attempts =
    kind === "honeypot"
      ? "type = 'spam'"
      : "type = 'blocked' AND json_extract(detail, '$.reason') = 'turnstile_failed'"
  const row = await env.DB.prepare(`SELECT COUNT(*) AS c FROM events WHERE form_id = ? AND ip_hash = ? AND created_at > ? AND ${attempts}`)
    .bind(form.id, ipHash, Date.now() - 60 * 60_000)
    .first<{ c: number }>()
  if ((row?.c ?? 0) < after) return false

  await addBlock(env, {
    cidr: target,
    reason: kind,
    formId: form.id,
    expiresAt: hours > 0 ? Date.now() + hours * 3_600_000 : null,
    mode: "extend",
  })
  return true
}
