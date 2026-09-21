import type { Route } from "./+types/forms.$formId.export"
import { requireAuth } from "~/server/auth.server"
import { getForm, parseSubmission, publicSubmission, type SubmissionRow } from "~/server/forms.server"

const PAGE = 2000
const MAX_ROWS = 100_000

// Spreadsheet apps execute cells that start with these characters.
function csvCell(value: unknown): string {
  if (value === undefined || value === null) return ""
  let s = typeof value === "object" ? JSON.stringify(value) : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await getForm(env, params.formId)
  if (!form) throw new Response("Form not found", { status: 404 })

  const format = new URL(request.url).searchParams.get("format") === "json" ? "json" : "csv"
  const rows: ReturnType<typeof parseSubmission>[] = []
  let after = 0
  while (rows.length < MAX_ROWS) {
    const res = await env.DB.prepare(
      "SELECT seq, id, form_id, data, meta, created_at FROM submissions WHERE form_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?"
    )
      .bind(form.id, after, PAGE)
      .all<SubmissionRow>()
    for (const r of res.results) rows.push(parseSubmission(r))
    if (res.results.length < PAGE) break
    after = res.results[res.results.length - 1].seq
  }

  const stamp = new Date().toISOString().slice(0, 10)

  if (format === "json") {
    return new Response(JSON.stringify(rows.map(publicSubmission), null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="${form.id}-${stamp}.json"`,
      },
    })
  }

  const keys = form.fields.map((f) => f.name)
  const known = new Set(keys)
  const extra = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r.data)) if (!known.has(k)) extra.add(k)
  const columns = [...keys, ...[...extra].sort()]

  const lines = [["id", "created_at", ...columns, "country", "device", "referrer"].map(csvCell).join(",")]
  for (const r of rows) {
    lines.push(
      [r.id, new Date(r.created_at).toISOString(), ...columns.map((c) => (Object.hasOwn(r.data, c) ? r.data[c] : undefined)), r.meta.country, r.meta.device, r.meta.referrer]
        .map(csvCell)
        .join(",")
    )
  }

  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${form.id}-${stamp}.csv"`,
    },
  })
}
