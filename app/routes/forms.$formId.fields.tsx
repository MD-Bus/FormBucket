import { useMemo, useState } from "react"
import { data, useFetcher, useLoaderData } from "react-router"
import { ArrowDown, ArrowUp, BarChart3, ChevronDown, ChevronRight, ListChecks, Plus, ListPlus, Trash2 } from "lucide-react"
import type { Route } from "./+types/forms.$formId.fields"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { Textarea } from "#/components/ui/textarea"
import { Switch } from "#/components/ui/switch"
import { NativeSelect } from "#/components/ui/native-select"
import { Badge } from "#/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#/components/ui/empty"
import { ResultButton } from "#/components/result-button"
import { FieldInsightsSheet } from "#/components/field-insights-sheet"
import {
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  inferFields,
  sanitizeFieldDefs,
  validateSubmission,
  type FieldDef,
  type FieldType,
  type UnknownFieldsMode,
} from "#/lib/schema"
import { requireAuth } from "~/server/auth.server"
import { getForm } from "~/server/forms.server"

export const meta: Route.MetaFunction = () => [{ title: "Fields | FormBucket" }]

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await getForm(env, params.formId)
  if (!form) throw new Response("Form not found", { status: 404 })

  const recent = await env.DB.prepare("SELECT data FROM submissions WHERE form_id = ? ORDER BY seq DESC LIMIT 50")
    .bind(form.id)
    .all<{ data: string }>()
  const samples = recent.results.flatMap((r) => {
    try {
      return [JSON.parse(r.data) as Record<string, unknown>]
    } catch {
      return []
    }
  })

  return { formId: form.id, fields: form.fields, unknownFields: form.unknown_fields, enforced: form.schema_enforced, samples }
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)

  const form = await request.formData()
  let raw: unknown
  try {
    raw = JSON.parse(String(form.get("fields") ?? "[]"))
  } catch {
    return data({ success: false, error: "Invalid fields payload" }, { status: 400 })
  }
  const result = sanitizeFieldDefs(raw)
  if (result.error) return data({ success: false, error: result.error }, { status: 400 })

  const mode = String(form.get("unknown_fields"))
  if (!["reject", "strip", "keep"].includes(mode)) return data({ success: false, error: "Invalid setting" }, { status: 400 })

  const enforced = form.get("schema_enforced") === "true" ? 1 : 0
  const res = await env.DB.prepare("UPDATE forms SET fields = ?, unknown_fields = ?, schema_enforced = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(result.fields), mode, enforced, Date.now(), params.formId)
    .run()
  if (res.meta.changes === 0) return data({ success: false, error: "Form not found" }, { status: 404 })
  return data({ success: true })
}

type Draft = FieldDef & { key: string; optionsText: string }

let counter = 0
const toDraft = (f: FieldDef): Draft => ({ ...f, key: `f${counter++}`, optionsText: (f.options ?? []).join("\n") })
const fromDraft = ({ key: _k, optionsText, ...f }: Draft): FieldDef => {
  const out: FieldDef = { ...f }
  if (f.type === "select") out.options = optionsText.split("\n").map((o) => o.trim()).filter(Boolean)
  else {
    delete out.options
    delete out.multiple
  }
  return out
}

const UNKNOWN_HELP: Record<UnknownFieldsMode, string> = {
  reject: "Reject the submission if it contains any field that is not listed here. Strictest, best against junk.",
  strip: "Accept the submission but silently drop fields that are not listed here.",
  keep: "Accept and store everything, only validating the fields listed here.",
}

function FieldRow({
  draft,
  index,
  count,
  open,
  onToggle,
  onChange,
  onMove,
  onRemove,
  onInspect,
}: {
  draft: Draft
  index: number
  count: number
  open: boolean
  onToggle: () => void
  onChange: (patch: Partial<Draft>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onInspect: () => void
}) {
  const textLike = ["text", "textarea", "email", "url", "phone"].includes(draft.type)
  const numeric = draft.type === "number" || draft.type === "integer"
  const num = (v: string) => (v === "" ? undefined : Number(v))

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" onClick={onToggle} aria-label="Toggle options">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </Button>
        <Input
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="field_name"
          className="min-w-32 flex-1 font-mono"
          aria-label="Field name"
        />
        <div className="w-36 shrink-0">
          <NativeSelect value={draft.type} onChange={(e) => onChange({ type: e.target.value as FieldType })} aria-label="Field type">
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {FIELD_TYPE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={draft.required} onCheckedChange={(v) => onChange({ required: v })} />
          Required
        </label>
        <div className="ml-auto flex items-center">
          <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onInspect} title="Insights" aria-label="Field insights">
            <BarChart3 className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-8" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
            <ArrowUp className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-8" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down">
            <ArrowDown className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label="Remove field">
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {open && (
        <div className="grid gap-4 border-t bg-muted/30 p-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Label (used in error messages)</Label>
            <Input value={draft.label ?? ""} onChange={(e) => onChange({ label: e.target.value })} placeholder={draft.name || "Your name"} />
          </div>
          <div className="space-y-2">
            <Label>Custom error message</Label>
            <Input value={draft.message ?? ""} onChange={(e) => onChange({ message: e.target.value })} placeholder="Shown when this field is invalid" />
          </div>
          {(textLike || numeric) && (
            <>
              <div className="space-y-2">
                <Label>{numeric ? "Minimum value" : "Minimum length"}</Label>
                <Input type="number" value={draft.min ?? ""} onChange={(e) => onChange({ min: num(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>{numeric ? "Maximum value" : "Maximum length"}</Label>
                <Input type="number" value={draft.max ?? ""} onChange={(e) => onChange({ max: num(e.target.value) })} />
              </div>
            </>
          )}
          {textLike && (
            <div className="space-y-2 sm:col-span-2">
              <Label>Must match pattern (regular expression)</Label>
              <Input
                value={draft.pattern ?? ""}
                onChange={(e) => onChange({ pattern: e.target.value })}
                placeholder="^[A-Z]{2}\d{4}$"
                className="font-mono"
              />
            </div>
          )}
          {draft.type === "select" && (
            <div className="space-y-2 sm:col-span-2">
              <Label>Allowed choices (one per line)</Label>
              <Textarea value={draft.optionsText} onChange={(e) => onChange({ optionsText: e.target.value })} placeholder={"Sales\nSupport\nOther"} rows={4} />
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={draft.multiple === true} onCheckedChange={(v) => onChange({ multiple: v })} />
                Allow selecting several
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function FieldsPage() {
  const { formId, fields, unknownFields, enforced: initialEnforced, samples } = useLoaderData<typeof loader>()
  const fetcher = useFetcher<{ success?: boolean; error?: string }>()

  const [drafts, setDrafts] = useState<Draft[]>(() => fields.map(toDraft))
  const [mode, setMode] = useState<UnknownFieldsMode>(unknownFields)
  const [enforced, setEnforced] = useState(initialEnforced)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [inspect, setInspect] = useState<string | null>(null)
  const [testInput, setTestInput] = useState('{\n  "email": "someone@example.com"\n}')

  const patch = (key: string, p: Partial<Draft>) => setDrafts((d) => d.map((x) => (x.key === key ? { ...x, ...p } : x)))
  const move = (i: number, dir: -1 | 1) =>
    setDrafts((d) => {
      const next = [...d]
      ;[next[i], next[i + dir]] = [next[i + dir], next[i]]
      return next
    })

  const defs = useMemo(() => drafts.map(fromDraft), [drafts])

  const testResult = useMemo(() => {
    try {
      const parsed = JSON.parse(testInput)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { parseError: "Enter a JSON object" }
      const clean = sanitizeFieldDefs(defs)
      if (!clean.fields) return { parseError: clean.error }
      return { result: validateSubmission(clean.fields, mode, parsed) }
    } catch {
      return { parseError: "Not valid JSON yet" }
    }
  }, [testInput, defs, mode])

  const addField = () => {
    const d = toDraft({ name: "", type: "text", required: false })
    setDrafts((list) => [...list, d])
    setOpenKey(d.key)
  }

  const infer = () => {
    const known = new Set(drafts.map((d) => d.name))
    const found = inferFields(samples).filter((f) => !known.has(f.name))
    setDrafts((d) => [...d, ...found.map(toDraft)])
  }

  const saving = fetcher.state !== "idle"
  const saved = fetcher.state === "idle" && fetcher.data?.success === true

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>Field schema</CardTitle>
          <CardDescription>
            Describe what a submission should look like. By default the form still accepts everything: turn on enforcement below
            when you want submissions that do not match to be rejected with a 422 and a per-field error list.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {drafts.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ListChecks className="h-8 w-8" />
                </EmptyMedia>
                <EmptyTitle>No fields yet</EmptyTitle>
                <EmptyDescription>This form currently accepts any data. Add fields to start validating.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button type="button" onClick={addField}>
                    <Plus className="size-4" /> Add field
                  </Button>
                  {samples.length > 0 && (
                    <Button type="button" variant="outline" onClick={infer}>
                      <ListPlus className="size-4" /> Add fields found in {samples.length} submissions
                    </Button>
                  )}
                </div>
              </EmptyContent>
            </Empty>
          ) : (
            <>
              {drafts.map((d, i) => (
                <FieldRow
                  key={d.key}
                  draft={d}
                  index={i}
                  count={drafts.length}
                  open={openKey === d.key}
                  onToggle={() => setOpenKey(openKey === d.key ? null : d.key)}
                  onChange={(p) => patch(d.key, p)}
                  onMove={(dir) => move(i, dir)}
                  onRemove={() => setDrafts((list) => list.filter((x) => x.key !== d.key))}
                  onInspect={() => d.name && setInspect(d.name)}
                />
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={addField}>
                  <Plus className="size-4" /> Add field
                </Button>
                {samples.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={infer}
                    title="Reads your latest 50 submissions and adds any field names not in the schema, guessing a type from the values. Nothing is saved until you press Save schema."
                  >
                    <ListPlus className="size-4" /> Add fields found in submissions
                  </Button>
                )}
              </div>
            </>
          )}

          {drafts.length > 0 && (
            <div className="space-y-4 border-t pt-4">
              <label className="flex items-start gap-3">
                <Switch checked={enforced} onCheckedChange={setEnforced} className="mt-0.5" />
                <span className="text-sm">
                  <span className="font-medium">Enforce this schema</span>
                  <span className="block text-xs text-muted-foreground">
                    {enforced
                      ? "On: submissions that break the rules below are rejected with a 422."
                      : "Off: every submission is accepted and stored, even if it does not match. Turn on when you are ready to block."}
                  </span>
                </span>
              </label>
              <div className={enforced ? "space-y-2" : "space-y-2 opacity-50"}>
              <Label htmlFor="unknown">Fields that are not in the list</Label>
              <div className="max-w-xs">
                <NativeSelect id="unknown" value={mode} disabled={!enforced} onChange={(e) => setMode(e.target.value as UnknownFieldsMode)}>
                  <option value="reject">Reject the submission</option>
                  <option value="strip">Drop them</option>
                  <option value="keep">Keep them</option>
                </NativeSelect>
              </div>
              <p className="text-xs text-muted-foreground">{UNKNOWN_HELP[mode]}</p>
              </div>
            </div>
          )}

          {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
          <fetcher.Form method="post" className="flex items-center gap-2">
            <input type="hidden" name="fields" value={JSON.stringify(defs)} />
            <input type="hidden" name="unknown_fields" value={mode} />
            <input type="hidden" name="schema_enforced" value={String(enforced)} />
            <ResultButton type="submit" isSubmitting={saving} isSuccess={saved} loadingText="Saving..." successText="Saved">
              Save schema
            </ResultButton>
            <span className="text-xs text-muted-foreground">Fields starting with “_” are reserved and always ignored.</span>
          </fetcher.Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Try it</CardTitle>
          <CardDescription>Paste a payload to see how it would be handled. Uses the fields above, even before you save.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Textarea value={testInput} onChange={(e) => setTestInput(e.target.value)} rows={8} className="font-mono text-xs" spellCheck={false} />
          <div className="rounded-md border p-3 text-sm">
            {"parseError" in testResult ? (
              <p className="text-muted-foreground">{testResult.parseError}</p>
            ) : testResult.result.ok ? (
              <div className="space-y-2">
                <Badge variant="success">Accepted</Badge>
                <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(testResult.result.data, null, 2)}</pre>
                {testResult.result.stripped.length > 0 && (
                  <p className="text-xs text-muted-foreground">Dropped: {testResult.result.stripped.join(", ")}</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {enforced ? (
                  <Badge variant="destructive">Rejected (422)</Badge>
                ) : (
                  <>
                    <Badge variant="success">Accepted (schema not enforced)</Badge>
                    <p className="text-xs text-muted-foreground">These problems would cause a rejection once enforcement is on:</p>
                  </>
                )}
                <ul className="list-disc space-y-1 pl-4">
                  {testResult.result.errors.map((e, i) => (
                    <li key={i}>
                      <span className="font-mono text-xs">{e.field}</span>: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <FieldInsightsSheet formId={formId} field={inspect} onClose={() => setInspect(null)} />
    </div>
  )
}
