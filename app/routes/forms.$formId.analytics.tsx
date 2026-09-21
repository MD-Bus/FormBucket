import { useState } from "react"
import { Link, useLoaderData } from "react-router"
import { ChevronRight, Info } from "lucide-react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import type { Route } from "./+types/forms.$formId.analytics"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "#/components/ui/chart"
import type { ChartConfig } from "#/components/ui/chart"
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { StatCard } from "#/components/stat-card"
import { FieldInsightsSheet, codeLabel } from "#/components/field-insights-sheet"
import { BreakdownSheet } from "#/components/breakdown-sheet"
import { requireAuth } from "~/server/auth.server"
import { getForm } from "~/server/forms.server"
import { getAnalytics, parseRange, type BreakdownKind } from "~/server/analytics.server"

export const meta: Route.MetaFunction = () => [{ title: "Analytics | FormBucket" }]

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await getForm(env, params.formId)
  if (!form) throw new Response("Form not found", { status: 404 })
  const range = parseRange(new URL(request.url).searchParams.get("range"))
  return { formId: form.id, originsSet: form.allowed_origins.length > 0, analytics: await getAnalytics(env, form, range) }
}

const chartConfig = {
  view: { label: "Views", color: "var(--chart-3)" },
  submit: { label: "Submissions", color: "var(--chart-2)" },
  reject: { label: "Rejected", color: "var(--chart-1)" },
  blocked: { label: "Blocked / spam", color: "var(--chart-5)" },
} satisfies ChartConfig

function Breakdown({
  title,
  data,
  showViews,
  capitalize = false,
  onViewAll,
}: {
  title: string
  data: { rows: { name: string; view: number; submit: number }[]; more: boolean }
  showViews: boolean
  capitalize?: boolean
  onViewAll: () => void
}) {
  const rows = data.rows
  const max = Math.max(1, ...rows.map((r) => Math.max(r.submit, showViews ? r.view : 0)))
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {data.more && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onViewAll}>
            View all <ChevronRight className="size-3" />
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((r) => (
              <li key={r.name} className="text-sm">
                <div className="flex justify-between gap-2">
                  <span className={capitalize ? "truncate capitalize" : "truncate"}>{r.name}</span>
                  <span className="text-muted-foreground tabular-nums">
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
      </CardContent>
    </Card>
  )
}

export default function AnalyticsPage() {
  const { formId, originsSet, analytics: a } = useLoaderData<typeof loader>()
  const [field, setField] = useState<string | null>(null)
  const [viewAll, setViewAll] = useState<BreakdownKind | null>(null)

  const tracking = a.totals.view > 0
  const conversion = a.totals.view > 0 ? Math.min(100, Math.round((a.totals.submit / a.totals.view) * 1000) / 10) : null
  const attempts = a.totals.submit + a.totals.reject
  const acceptRate = attempts > 0 ? Math.round((a.totals.submit / attempts) * 100) : null
  const funnelMax = Math.max(1, a.totals.view, a.totals.start, a.totals.submit)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Analytics</h2>
          <p className="text-sm text-muted-foreground">How your form is performing and what people get wrong.</p>
        </div>
        <div className="inline-flex rounded-md border p-0.5">
          {[7, 30, 90].map((d) => (
            <Button key={d} asChild size="sm" variant={a.range === d ? "secondary" : "ghost"} className="h-7 px-3 text-xs">
              <Link to={`?range=${d}`} preventScrollReset>
                {d}d
              </Link>
            </Button>
          ))}
        </div>
      </div>

      {!tracking && (
        <Alert>
          <Info />
          <AlertTitle>Views and conversion need the tracking snippet</AlertTitle>
          <AlertDescription>
            Add one script tag to the page that hosts your form to see views, started forms and conversion rate.{" "}
            <Link to="../integration" className="underline underline-offset-2">
              Get the snippet
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {a.blockReasons.some((b) => b.reason === "views_capped") && (
        <Alert variant="destructive">
          <Info />
          <AlertTitle>Some views were not counted</AlertTitle>
          <AlertDescription>
            Traffic to the tracking endpoint went above 300 views per minute in this period, so the extra views were dropped to protect your database. Views and conversion are understated for those minutes. If it was not a real spike, limit which sites can report views under Settings → Allowed origins.
          </AlertDescription>
        </Alert>
      )}
      {tracking && !originsSet && (
        <Alert>
          <Info />
          <AlertTitle>Anyone can report views for this form</AlertTitle>
          <AlertDescription>
            Views come from a public tracking endpoint. Set <span className="text-foreground">Allowed origins</span> in{" "}
            <Link to="../settings" className="underline underline-offset-2">
              Settings
            </Link>{" "}
            so only your own websites count, which keeps views and conversion accurate.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Submissions" value={a.totals.submit} hint={`${a.visitors.submit} people`} />
        <StatCard title="Views" value={tracking ? a.totals.view : "—"} hint={tracking ? `${a.visitors.view} visitors` : undefined} />
        <StatCard title="Conversion" value={conversion === null ? "—" : `${conversion}%`} hint="views → sent" />
        <StatCard title="Accepted" value={acceptRate === null ? "—" : `${acceptRate}%`} hint={`${a.totals.reject} rejected · ${a.totals.spam + a.totals.blocked} blocked`} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Activity</CardTitle>
          <CardDescription>Daily events over the last {a.range} days (UTC)</CardDescription>
        </CardHeader>
        <CardContent className="pb-4">
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <LineChart accessibilityLayer data={a.daily} margin={{ left: -20, right: 10 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} tickMargin={8} axisLine={false} interval="preserveStartEnd" minTickGap={40} />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              {tracking && <Line type="monotone" dataKey="view" stroke="var(--color-view)" strokeWidth={2} dot={false} isAnimationActive={false} />}
              <Line type="monotone" dataKey="submit" stroke="var(--color-submit)" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="reject" stroke="var(--color-reject)" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="blocked" stroke="var(--color-blocked)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        {tracking && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Funnel</CardTitle>
              <CardDescription>Where people drop off</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "Viewed the form", value: a.totals.view },
                { label: "Started filling it", value: a.totals.start },
                { label: "Submitted", value: a.totals.submit },
              ].map((step) => (
                <div key={step.label} className="text-sm">
                  <div className="flex justify-between">
                    <span>{step.label}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {step.value}
                      {a.totals.view > 0 && ` · ${Math.min(100, Math.round((step.value / a.totals.view) * 100))}%`}
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-muted">
                    <div className="h-2 rounded-full bg-[var(--chart-2)]" style={{ width: `${(step.value / funnelMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">What gets rejected</CardTitle>
              {a.rejections.more && (
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setViewAll("rejections")}>
                  View all <ChevronRight className="size-3" />
                </Button>
              )}
            </div>
            <CardDescription>Fields that fail validation most</CardDescription>
          </CardHeader>
          <CardContent>
            {a.rejections.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rejected submissions in this period.</p>
            ) : (
              <ul className="space-y-1">
                {a.rejections.rows.map((r) => (
                  <li key={`${r.field}-${r.code}`}>
                    <button
                      type="button"
                      onClick={() => setField(r.field)}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-mono">{r.field}</span>
                        <Badge variant="warning">{codeLabel(r.code)}</Badge>
                      </span>
                      <span className="text-muted-foreground tabular-nums">{r.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {a.blockReasons.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Blocked before validation</p>
                <ul className="space-y-1 text-sm">
                  {a.blockReasons.map((b) => (
                    <li key={b.reason} className="flex justify-between">
                      <span>{b.reason.replace(/_/g, " ")}</span>
                      <span className="text-muted-foreground tabular-nums">{b.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid min-w-0 gap-3 md:grid-cols-3">
        <Breakdown title="Countries" data={a.countries} showViews={tracking} onViewAll={() => setViewAll("countries")} />
        <Breakdown title="Sites" data={a.sites} showViews={tracking} onViewAll={() => setViewAll("sites")} />
        <Breakdown title="Devices" data={a.devices} showViews={tracking} capitalize onViewAll={() => setViewAll("devices")} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Fields</CardTitle>
          <CardDescription>Click a field to open its insights: top values, fill rate and rejections</CardDescription>
        </CardHeader>
        <CardContent>
          {a.fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">Define fields or receive a submission to see field stats.</p>
          ) : (
            <ul className="divide-y">
              {a.fields.map((f) => {
                const pct = f.total > 0 ? Math.round((f.filled / f.total) * 100) : 0
                return (
                  <li key={f.name}>
                    <button
                      type="button"
                      onClick={() => setField(f.name)}
                      className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-md px-2 py-2.5 text-left hover:bg-accent sm:grid-cols-[minmax(0,1fr)_120px_140px]"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-mono text-sm">{f.name}</span>
                        <Badge variant="outline">{f.type}</Badge>
                        {f.required && <Badge variant="secondary">required</Badge>}
                        {!f.declared && <Badge variant="warning">not in schema</Badge>}
                      </span>
                      <span className="text-right text-sm text-muted-foreground tabular-nums sm:text-left">
                        {f.filled}/{f.total} filled
                      </span>
                      <span className="col-span-2 h-1.5 rounded-full bg-muted sm:col-span-1">
                        <span className="block h-1.5 rounded-full bg-[var(--chart-2)]" style={{ width: `${pct}%` }} />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <BreakdownSheet
        formId={formId}
        kind={viewAll}
        range={a.range}
        showViews={tracking}
        onClose={() => setViewAll(null)}
        onSelectField={setField}
      />
      <FieldInsightsSheet formId={formId} field={field} range={a.range} onClose={() => setField(null)} />
    </div>
  )
}
