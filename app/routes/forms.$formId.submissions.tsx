import { useMemo, useState } from "react"
import { Link, useLoaderData } from "react-router"
import { Download, FileJson, Inbox } from "lucide-react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import type { Route } from "./+types/forms.$formId.submissions"
import { createColumns } from "./forms.$formId.submissions/columns"
import { DataTable } from "./forms.$formId.submissions/data-table"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#/components/ui/empty"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "#/components/ui/chart"
import type { ChartConfig } from "#/components/ui/chart"
import { StatCard } from "#/components/stat-card"
import { SubmissionSheet } from "#/components/submission-sheet"
import { FieldInsightsSheet } from "#/components/field-insights-sheet"
import { requireAuth } from "~/server/auth.server"
import { getForm, parseSubmission, type Submission, type SubmissionRow } from "~/server/forms.server"

export const meta: Route.MetaFunction = () => [{ title: "Submissions | FormBucket" }]

const DAY = 86_400_000
const trend = (current: number, previous: number) =>
  previous === 0 ? (current > 0 ? 100 : 0) : Math.round(((current - previous) / previous) * 100)

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)

  const form = await getForm(env, params.formId)
  if (!form) throw new Response("Form not found", { status: 404 })

  const now = Date.now()
  // One round trip for the table, the stats and the chart.
  const [rowsRes, statsRes, dailyRes] = await env.DB.batch([
    env.DB.prepare("SELECT seq, id, form_id, data, meta, created_at FROM submissions WHERE form_id = ? ORDER BY seq DESC LIMIT 1000").bind(form.id),
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
        COALESCE(SUM(created_at >= ?2), 0) AS week, COALESCE(SUM(created_at >= ?3 AND created_at < ?2), 0) AS prev_week,
        COALESCE(SUM(created_at >= ?4), 0) AS month, COALESCE(SUM(created_at >= ?5 AND created_at < ?4), 0) AS prev_month
       FROM submissions WHERE form_id = ?1`
    ).bind(form.id, now - 7 * DAY, now - 14 * DAY, now - 30 * DAY, now - 60 * DAY),
    env.DB.prepare(
      `SELECT date(created_at / 1000, 'unixepoch') AS d, COUNT(*) AS c FROM submissions
       WHERE form_id = ? AND created_at >= ? GROUP BY d`
    ).bind(form.id, now - 30 * DAY),
  ])
  const rows = { results: rowsRes.results as SubmissionRow[] }
  const stats = (statsRes.results as { total: number; week: number; prev_week: number; month: number; prev_month: number }[])[0]
  const daily = { results: dailyRes.results as { d: string; c: number }[] }

  const counts = new Map(daily.results.map((r) => [r.d, r.c]))
  const chartData = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(now - (29 - i) * DAY)
    return {
      date: date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      count: counts.get(date.toISOString().slice(0, 10)) ?? 0,
    }
  })

  const s = stats!
  return {
    formId: form.id,
    fieldOrder: form.fields.map((f) => f.name),
    submissions: rows.results.map(parseSubmission),
    stats: {
      total: s.total,
      thisWeek: s.week,
      thisMonth: s.month,
      weekTrend: trend(s.week, s.prev_week),
      monthTrend: trend(s.month, s.prev_month),
    },
    chartData,
  }
}

const chartConfig = { count: { label: "Submissions", color: "var(--chart-2)" } } satisfies ChartConfig

export default function SubmissionsPage() {
  const { formId, fieldOrder, submissions, stats, chartData } = useLoaderData<typeof loader>()
  const [selected, setSelected] = useState<Submission | null>(null)
  const [field, setField] = useState<string | null>(null)

  const columns = useMemo(() => createColumns(submissions, fieldOrder, setField), [submissions, fieldOrder])

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="grid min-w-0 gap-2 md:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Total Submissions" value={stats.total} />
        <StatCard title="This Week" value={stats.thisWeek} trend={stats.weekTrend} />
        <StatCard title="This Month" value={stats.thisMonth} trend={stats.monthTrend} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Last 30 Days</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <ChartContainer config={chartConfig} className="h-[140px] w-full">
            <LineChart accessibilityLayer data={chartData} margin={{ left: -20, right: 10 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickLine={false} tickMargin={8} axisLine={false} interval="preserveStartEnd" minTickGap={50} />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line type="linear" dataKey="count" stroke="var(--color-count)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {submissions.length === 0 ? (
        <div className="flex min-w-0 flex-1 items-center justify-center py-12">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox className="h-10 w-10" />
              </EmptyMedia>
              <EmptyTitle>No submissions yet</EmptyTitle>
              <EmptyDescription>Get started by sending your first submission to this form.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild>
                <Link to="../integration">Integrate</Link>
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={submissions}
          total={stats.total}
          onRowClick={setSelected}
          headerAction={
            <>
              <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
                <a href={`/forms/${formId}/export?format=json`} download>
                  <FileJson className="h-3 w-3" />
                  JSON
                </a>
              </Button>
              <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
                <a href={`/forms/${formId}/export?format=csv`} download>
                  <Download className="h-3 w-3" />
                  Export CSV
                </a>
              </Button>
            </>
          }
        />
      )}

      <SubmissionSheet submission={selected} onClose={() => setSelected(null)} onInspectField={setField} />
      <FieldInsightsSheet formId={formId} field={field} onClose={() => setField(null)} />
    </div>
  )
}
