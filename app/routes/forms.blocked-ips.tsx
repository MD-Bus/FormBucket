import { useEffect, useState } from "react"
import { data, Form, Link, useFetcher, useLoaderData } from "react-router"
import { formatDistanceToNow } from "date-fns"
import { Loader2, Plus, Search, ShieldBan } from "lucide-react"
import type { Route } from "./+types/forms.blocked-ips"
import { PageHeader } from "#/components/page-header"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { Badge } from "#/components/ui/badge"
import { NativeSelect } from "#/components/ui/native-select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog"
import { cidrContains, parseIp, validateBlockInput } from "#/lib/ip"
import { requireAuth } from "~/server/auth.server"
import { addBlock, listBlocks, removeBlock, type BlockRow } from "~/server/blocks.server"
import { clientIp } from "~/server/util.server"

export const meta: Route.MetaFunction = () => [{ title: "Blocked IPs | FormBucket" }]

const DURATIONS: Record<string, { label: string; ms: number | null }> = {
  "1h": { label: "1 hour", ms: 3_600_000 },
  "24h": { label: "24 hours", ms: 86_400_000 },
  "7d": { label: "7 days", ms: 7 * 86_400_000 },
  "30d": { label: "30 days", ms: 30 * 86_400_000 },
  forever: { label: "Permanently", ms: null },
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const url = new URL(request.url)
  const q = url.searchParams.get("q") ?? ""
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0)
  const [list, forms] = await Promise.all([
    listBlocks(env, q, page),
    env.DB.prepare("SELECT id, name FROM forms").all<{ id: string; name: string }>(),
  ])
  return {
    ...list,
    q,
    yourAddress: clientIp(request),
    formNames: Object.fromEntries(forms.results.map((f) => [f.id, f.name])),
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const body = await request.formData()
  const intent = String(body.get("intent"))

  if (intent === "remove") {
    await removeBlock(env, String(body.get("id") ?? ""))
    return data({ ok: true })
  }

  if (intent === "add") {
    const check = validateBlockInput(String(body.get("address") ?? ""))
    if (!check.ok) return data({ ok: false, error: check.error }, { status: 400 })

    const duration = DURATIONS[String(body.get("duration"))]
    if (!duration) return data({ ok: false, error: "Choose how long to block for." }, { status: 400 })

    // Blocks only affect the public form endpoints, never this dashboard, but blocking yourself would
    // stop you testing your own forms, which is almost never intended.
    const me = parseIp(clientIp(request))
    if (me && cidrContains(check.parsed, me)) {
      return data({ ok: false, error: `That range includes your own address (${clientIp(request)}). You would not be able to submit your own forms.` }, { status: 400 })
    }

    await addBlock(env, {
      cidr: check.cidr,
      reason: "manual",
      note: String(body.get("note") ?? "").trim().slice(0, 120) || null,
      expiresAt: duration.ms === null ? null : Date.now() + duration.ms,
      mode: "replace",
    })
    return data({ ok: true, added: check.cidr })
  }

  return data({ ok: false, error: "Unknown action" }, { status: 400 })
}

const reasonBadge: Record<BlockRow["reason"], { label: string; variant: "secondary" | "warning" | "destructive" }> = {
  manual: { label: "Manual", variant: "secondary" },
  honeypot: { label: "Honeypot", variant: "warning" },
  turnstile: { label: "Turnstile", variant: "destructive" },
}

export default function BlockedIpsPage() {
  const { rows, total, page, pageSize, q, yourAddress, formNames } = useLoaderData<typeof loader>()
  const add = useFetcher<{ ok?: boolean; error?: string; added?: string }>()
  const remove = useFetcher()
  const [target, setTarget] = useState<BlockRow | null>(null)
  const [address, setAddress] = useState("")

  useEffect(() => {
    if (add.state === "idle" && add.data?.added) setAddress("")
  }, [add.state, add.data])
  useEffect(() => {
    if (remove.state === "idle" && remove.data) setTarget(null)
  }, [remove.state, remove.data])

  const pages = Math.max(1, Math.ceil(total / pageSize))
  const link = (p: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`

  return (
    <>
      <PageHeader crumbs={[{ label: "FormBucket", to: "/forms" }, { label: "Blocked IPs" }]} />
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 pt-0">
        <Card>
          <CardHeader>
            <CardTitle>Block an address</CardTitle>
            <CardDescription>
              Blocked visitors are refused on every form&apos;s public endpoint, before anything is read or written. Your dashboard is never affected. Enter a single IPv4 or IPv6 address, or a range such as <code className="rounded bg-muted px-1 py-0.5 text-xs">203.0.113.0/24</code> or <code className="rounded bg-muted px-1 py-0.5 text-xs">2001:db8::/48</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <add.Form method="post" className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1.2fr)_auto] md:items-end">
              <input type="hidden" name="intent" value="add" />
              <div className="space-y-2">
                <Label htmlFor="address">IP address or range</Label>
                <Input id="address" name="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="203.0.113.7" className="font-mono" required autoComplete="off" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="duration">Block for</Label>
                <NativeSelect id="duration" name="duration" defaultValue="24h">
                  {Object.entries(DURATIONS).map(([value, d]) => (
                    <option key={value} value={value}>
                      {d.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="note">Note (optional)</Label>
                <Input id="note" name="note" maxLength={120} placeholder="Scraper seen in logs" />
              </div>
              <Button type="submit" disabled={add.state !== "idle"}>
                {add.state !== "idle" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Block
              </Button>
            </add.Form>
            {add.data?.error && <p className="mt-3 text-sm text-destructive">{add.data.error}</p>}
            {add.data?.added && add.state === "idle" && <p className="mt-3 text-sm text-green-600 dark:text-green-500">Blocked {add.data.added}. It takes effect within about 10 seconds everywhere.</p>}
            <p className="mt-3 text-xs text-muted-foreground">
              Your current address is <span className="font-mono">{yourAddress}</span>. Ranges broader than /16 (IPv4) or /32 (IPv6) are refused, and so is a range that contains your own address.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle>Blocked addresses</CardTitle>
              <CardDescription>
                {total} active block{total === 1 ? "" : "s"}. Automatic blocks come from the rules in each form&apos;s settings, and expired blocks disappear on their own. This is the only place FormBucket stores real IP addresses.
              </CardDescription>
            </div>
            <Form method="get" className="relative w-56 shrink-0">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={q} placeholder="Search..." className="pl-8" aria-label="Search blocked addresses" />
            </Form>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ShieldBan className="h-8 w-8" />
                  </EmptyMedia>
                  <EmptyTitle>{q ? "No blocks match your search" : "Nothing is blocked"}</EmptyTitle>
                  <EmptyDescription>{q ? "Try a different search." : "Addresses appear here when you block them or when a form's automatic rules trigger."}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Address</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Form</TableHead>
                        <TableHead>Note</TableHead>
                        <TableHead>Blocked</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-sm">{r.cidr}</TableCell>
                          <TableCell>
                            <Badge variant={reasonBadge[r.reason].variant}>{reasonBadge[r.reason].label}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{r.form_id ? (formNames[r.form_id] ?? r.form_id) : "—"}</TableCell>
                          <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">{r.note ?? ""}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDistanceToNow(r.created_at, { addSuffix: true })}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{r.expires_at ? `in ${formatDistanceToNow(r.expires_at)}` : "Never"}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setTarget(r)}>
                              Unblock
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {pages > 1 && (
                  <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      Page {page + 1} of {pages}
                    </span>
                    <div className="flex gap-2">
                      <Button asChild variant="outline" size="sm" disabled={page === 0}>
                        <Link to={link(page - 1)} aria-disabled={page === 0} className={page === 0 ? "pointer-events-none opacity-50" : undefined}>
                          Previous
                        </Link>
                      </Button>
                      <Button asChild variant="outline" size="sm">
                        <Link to={link(page + 1)} aria-disabled={page + 1 >= pages} className={page + 1 >= pages ? "pointer-events-none opacity-50" : undefined}>
                          Next
                        </Link>
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={target !== null} onOpenChange={(open) => remove.state === "idle" && !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unblock {target?.cidr}?</DialogTitle>
            <DialogDescription>It will be able to submit to your forms again within about 10 seconds. If it keeps misbehaving, the automatic rules will block it again.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={remove.state !== "idle"}>
              Cancel
            </Button>
            <Button disabled={remove.state !== "idle"} onClick={() => target && remove.submit({ intent: "remove", id: target.id }, { method: "post" })}>
              {remove.state !== "idle" ? "Unblocking..." : "Unblock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
