import { useEffect, useState } from "react"
import { useFetcher } from "react-router"
import { formatDistanceToNow } from "date-fns"
import { Loader2 } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "#/components/ui/sheet"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { FIELD_TYPE_LABELS } from "#/lib/schema"
import type { FieldInsights } from "~/server/analytics.server"

const CODE_LABELS: Record<string, string> = {
  required: "Missing (required)",
  invalid_format: "Wrong format",
  invalid_type: "Wrong type",
  invalid_option: "Not an allowed choice",
  too_short: "Too short",
  too_long: "Too long",
  too_small: "Below minimum",
  too_large: "Above maximum",
  pattern: "Pattern mismatch",
  unknown_field: "Not in the schema",
  file_not_supported: "File upload",
}
export const codeLabel = (code: string) => CODE_LABELS[code] ?? code

export function FieldInsightsSheet({
  formId,
  field,
  range = 30,
  onClose,
}: {
  formId: string
  field: string | null
  range?: number
  onClose: () => void
}) {
  const fetcher = useFetcher<{ insights: FieldInsights }>()
  const [showAll, setShowAll] = useState(false)

  useEffect(() => setShowAll(false), [field])

  useEffect(() => {
    if (field) fetcher.load(`/forms/${formId}/fields/${encodeURIComponent(field)}?range=${range}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, formId, range])

  const data = fetcher.data?.insights
  const ready = data && data.name === field
  const fill = ready && data.total > 0 ? Math.round((data.filled / data.total) * 100) : 0
  const maxTop = ready ? Math.max(1, ...data.top.map((t) => t.count)) : 1

  return (
    <Sheet open={field !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-mono">{field}</SheetTitle>
          <SheetDescription>
            Last {range} days
            {ready && data.def ? ` · ${FIELD_TYPE_LABELS[data.def.type]}${data.def.required ? " · required" : ""}` : ""}
          </SheetDescription>
        </SheetHeader>

        {!ready ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-6 px-4 pb-6">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Filled</p>
                <p className="text-lg font-semibold">{fill}%</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Answers</p>
                <p className="text-lg font-semibold">{data.filled}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Distinct</p>
                <p className="text-lg font-semibold">{data.distinct}</p>
              </div>
            </div>

            {data.numeric && (
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                {(["min", "avg", "max"] as const).map((k) => (
                  <div key={k} className="rounded-lg bg-muted p-2">
                    <p className="text-xs text-muted-foreground uppercase">{k}</p>
                    <p className="font-medium">{Number(data.numeric![k].toFixed(2))}</p>
                  </div>
                ))}
              </div>
            )}

            <section className="space-y-2">
              <h4 className="text-sm font-medium">Top values</h4>
              {data.top.length === 0 ? (
                <p className="text-sm text-muted-foreground">No values yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(showAll ? data.top : data.top.slice(0, 10)).map((t) => (
                    <li key={t.value} className="text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="truncate">{t.value}</span>
                        <span className="text-muted-foreground tabular-nums">{t.count}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-muted">
                        <div className="h-1.5 rounded-full bg-[var(--chart-2)]" style={{ width: `${(t.count / maxTop) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {data.top.length > 10 && (
                <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowAll((v) => !v)}>
                  {showAll
                    ? "Show fewer"
                    : `Show all ${data.top.length}${data.distinct > data.top.length ? ` (top ${data.top.length} of ${data.distinct})` : ""}`}
                </Button>
              )}
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-medium">Why submissions were rejected</h4>
              {data.rejections.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rejections for this field.</p>
              ) : (
                <ul className="space-y-1">
                  {data.rejections.map((r) => (
                    <li key={r.code} className="flex items-center justify-between text-sm">
                      <Badge variant="warning">{codeLabel(r.code)}</Badge>
                      <span className="text-muted-foreground tabular-nums">{r.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-medium">Latest values</h4>
              {data.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing yet.</p>
              ) : (
                <ul className="divide-y rounded-md border text-sm">
                  {data.recent.map((r, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="truncate">{r.value}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDistanceToNow(r.created_at, { addSuffix: true })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
