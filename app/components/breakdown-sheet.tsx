import { useEffect, useRef, useState } from "react"
import { useFetcher } from "react-router"
import { Loader2, Search } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "#/components/ui/sheet"
import { Input } from "#/components/ui/input"
import { Button } from "#/components/ui/button"
import { Badge } from "#/components/ui/badge"
import { codeLabel } from "#/components/field-insights-sheet"
import type { BreakdownKind, DimensionRow, RejectionRow } from "~/server/analytics.server"

type Page = { kind: BreakdownKind; offset: number; hasMore: boolean; rows: (DimensionRow | RejectionRow)[] }

const TITLES: Record<BreakdownKind, string> = {
  countries: "Countries",
  sites: "Sites",
  devices: "Devices",
  rejections: "What gets rejected",
}

/** Searchable, paged "View all" list for one analytics card. */
export function BreakdownSheet({
  formId,
  kind,
  range,
  showViews,
  onClose,
  onSelectField,
}: {
  formId: string
  kind: BreakdownKind | null
  range: number
  showViews: boolean
  onClose: () => void
  onSelectField: (field: string) => void
}) {
  const fetcher = useFetcher<Page>()
  const [q, setQ] = useState("")
  const [rows, setRows] = useState<Page["rows"]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const latest = useRef({ kind, q })
  latest.current = { kind, q }

  const load = (offset: number, query: string) => {
    if (!kind) return
    fetcher.load(`/forms/${formId}/analytics/${kind}?range=${range}&offset=${offset}&q=${encodeURIComponent(query)}`)
  }

  // Reset whenever a different list is opened.
  useEffect(() => {
    setQ("")
    setRows([])
    setHasMore(false)
    setLoaded(false)
    if (kind) load(0, "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, range, formId])

  // Debounced search restarts from the first page.
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    if (!kind) return
    const t = setTimeout(() => load(0, q), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  // Apply responses, ignoring stale ones from a previous list.
  useEffect(() => {
    const d = fetcher.data
    if (!d || d.kind !== latest.current.kind) return
    setRows((prev) => (d.offset === 0 ? d.rows : [...prev, ...d.rows]))
    setHasMore(d.hasMore)
    setLoaded(true)
  }, [fetcher.data])

  const loading = fetcher.state !== "idle"
  const dimensionRows = kind && kind !== "rejections" ? (rows as DimensionRow[]) : []
  const max = Math.max(1, ...dimensionRows.map((r) => Math.max(r.submit, showViews ? r.view : 0)))
  const rejectionMax = Math.max(1, ...(kind === "rejections" ? (rows as RejectionRow[]).map((r) => r.count) : [1]))

  return (
    <Sheet open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col overflow-hidden sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{kind ? TITLES[kind] : ""}</SheetTitle>
          <SheetDescription>Last {range} days</SheetDescription>
        </SheetHeader>

        <div className="relative px-4">
          <Search className="pointer-events-none absolute top-1/2 left-7 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search..." className="pl-9" aria-label="Search" />
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {!loaded ? (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{q ? "Nothing matches your search." : "No data yet."}</p>
          ) : kind === "rejections" ? (
            <ul className="space-y-1">
              {(rows as RejectionRow[]).map((r) => (
                <li key={`${r.field}-${r.code}`}>
                  <button
                    type="button"
                    onClick={() => onSelectField(r.field)}
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-mono">{r.field}</span>
                        <Badge variant="warning">{codeLabel(r.code)}</Badge>
                      </span>
                      <span className="text-muted-foreground tabular-nums">{r.count}</span>
                    </span>
                    <span className="mt-1 block h-1.5 rounded-full bg-muted">
                      <span className="block h-1.5 rounded-full bg-[var(--chart-1)]" style={{ width: `${(r.count / rejectionMax) * 100}%` }} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="space-y-3 pt-2">
              {dimensionRows.map((r) => (
                <li key={r.name} className="text-sm">
                  <div className="flex justify-between gap-2">
                    <span className={kind === "devices" ? "truncate capitalize" : "truncate"}>{r.name}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {showViews ? `${r.view} ${r.view === 1 ? "view" : "views"} · ` : ""}
                      {r.submit} sent
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-[var(--chart-2)]" style={{ width: `${(r.submit / max) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {loaded && hasMore && (
            <Button variant="outline" className="mt-4 w-full" disabled={loading} onClick={() => load(rows.length, q)}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Load more"}
            </Button>
          )}
          {loaded && rows.length > 0 && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              {rows.length} shown{hasMore ? "" : " · end of list"}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
