import { useEffect, useState } from "react"
import { data, useFetcher, useLoaderData } from "react-router"
import { formatDistanceToNow } from "date-fns"
import { Eye, EyeOff, RefreshCw, RotateCw, Send } from "lucide-react"
import type { Route } from "./+types/forms.$formId.webhook"
import { Button } from "#/components/ui/button"
import { Badge } from "#/components/ui/badge"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { Switch } from "#/components/ui/switch"
import { Textarea } from "#/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { ResultButton } from "#/components/result-button"
import { CodeBlock, InlineCode } from "#/components/code-block"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table"
import { requireAuth } from "~/server/auth.server"
import { getForm } from "~/server/forms.server"
import { randomString } from "~/server/util.server"
import { MAX_ATTEMPTS, resendDelivery, sendTestWebhook, validateWebhookUrl } from "~/server/webhook.server"

export const meta: Route.MetaFunction = () => [{ title: "Webhook | FormBucket" }]

type DeliveryRow = {
  id: string
  event: string
  status: "pending" | "success" | "failed"
  attempts: number
  response_status: number | null
  error: string | null
  next_attempt_at: number | null
  created_at: number
  submission_id: string | null
}

const RESERVED_HEADERS = /^(host|content-length|content-type|user-agent|x-formbucket-.*)$/i

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await getForm(env, params.formId)
  if (!form) throw new Response("Form not found", { status: 404 })

  const deliveries = await env.DB.prepare(
    `SELECT id, event, status, attempts, response_status, error, next_attempt_at, created_at, submission_id
     FROM webhook_deliveries WHERE form_id = ? ORDER BY created_at DESC LIMIT 25`
  )
    .bind(form.id)
    .all<DeliveryRow>()

  return {
    enabled: form.webhook_enabled,
    url: form.webhook_url ?? "",
    secret: form.webhook_secret ?? "",
    headers: Object.entries(form.webhook_headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n"),
    deliveries: deliveries.results,
    maxAttempts: MAX_ATTEMPTS,
  }
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await getForm(env, params.formId)
  if (!form) return data({ error: "Form not found" }, { status: 404 })

  const body = await request.formData()
  const intent = String(body.get("intent"))

  if (intent === "save") {
    const enabled = body.get("enabled") === "true"
    const url = String(body.get("url") ?? "").trim()
    if (enabled || url) {
      // Local development (localhost) may target local receivers; deployed Workers may not.
      const problem = validateWebhookUrl(url, new URL(request.url).hostname === "localhost", new URL(request.url).host)
      if (problem) return data({ intent, error: problem }, { status: 400 })
    }

    const headers: Record<string, string> = {}
    for (const line of String(body.get("headers") ?? "").split("\n")) {
      if (!line.trim()) continue
      const idx = line.indexOf(":")
      const name = line.slice(0, idx).trim()
      const value = line.slice(idx + 1).trim()
      if (idx < 1 || !/^[A-Za-z0-9-]{1,60}$/.test(name) || !value) {
        return data({ intent, error: `Invalid header line: "${line.trim()}". Use "Name: value".` }, { status: 400 })
      }
      if (RESERVED_HEADERS.test(name)) return data({ intent, error: `Header "${name}" is set by FormBucket and cannot be overridden.` }, { status: 400 })
      headers[name] = value
    }
    if (Object.keys(headers).length > 10) return data({ intent, error: "At most 10 custom headers" }, { status: 400 })

    const secret = form.webhook_secret || `whsec_${randomString(32)}`
    await env.DB.prepare(
      "UPDATE forms SET webhook_enabled = ?, webhook_url = ?, webhook_secret = ?, webhook_headers = ?, updated_at = ? WHERE id = ?"
    )
      .bind(enabled ? 1 : 0, url || null, secret, JSON.stringify(headers), Date.now(), form.id)
      .run()
    return data({ intent, success: true })
  }

  if (intent === "regenerate") {
    await env.DB.prepare("UPDATE forms SET webhook_secret = ?, updated_at = ? WHERE id = ?")
      .bind(`whsec_${randomString(32)}`, Date.now(), form.id)
      .run()
    return data({ intent, success: true })
  }

  if (intent === "test") {
    const result = await sendTestWebhook(env, form)
    return data({ intent, success: result.ok, error: result.ok ? undefined : (result.error ?? "Request failed"), status: result.status })
  }

  if (intent === "resend") {
    const id = String(body.get("delivery") ?? "")
    const owned = await env.DB.prepare("SELECT 1 FROM webhook_deliveries WHERE id = ? AND form_id = ?").bind(id, form.id).first()
    if (!owned) return data({ intent, error: "Delivery not found" }, { status: 404 })
    await resendDelivery(env, id)
    return data({ intent, success: true })
  }

  return data({ error: "Unknown action" }, { status: 400 })
}

const statusVariant = { success: "success", pending: "warning", failed: "destructive" } as const

export default function WebhookPage() {
  const loaded = useLoaderData<typeof loader>()
  const save = useFetcher<{ success?: boolean; error?: string }>()
  const test = useFetcher<{ success?: boolean; error?: string; status?: number | null }>()
  const regen = useFetcher()
  const resend = useFetcher()

  const [enabled, setEnabled] = useState(loaded.enabled)
  const [url, setUrl] = useState(loaded.url)
  const [headers, setHeaders] = useState(loaded.headers)
  const [reveal, setReveal] = useState(false)

  useEffect(() => {
    setEnabled(loaded.enabled)
    setUrl(loaded.url)
    setHeaders(loaded.headers)
  }, [loaded.enabled, loaded.url, loaded.headers])

  const saving = save.state !== "idle"
  const saved = save.state === "idle" && save.data?.success === true
  const testing = test.state !== "idle"

  const payload = `{
  "event": "submission.created",
  "form": { "id": "contact", "name": "Contact" },
  "submission": {
    "id": "sub_0mf3k2x9a8h1b2c3d4e5",
    "seq": 42,
    "form_id": "contact",
    "created_at": "2026-01-31T10:15:30.000Z",
    "data": { "name": "Jane", "email": "jane@example.com" },
    "meta": { "country": "CA", "device": "desktop", "referrer": "example.com" }
  }
}`

  const verify = `import crypto from 'node:crypto'

// rawBody must be the exact request body string, before JSON.parse
export function verify(rawBody, headers, secret) {
  const timestamp = headers['x-formbucket-timestamp']
  const signature = headers['x-formbucket-signature']
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(\`\${timestamp}.\${rawBody}\`).digest('hex')
  return (
    signature?.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
}`

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>Webhook</CardTitle>
          <CardDescription>
            Send every accepted submission to a URL, for example an n8n, Zapier or Make trigger or your own server. Failed deliveries are retried up to {loaded.maxAttempts} times with backoff.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <save.Form method="post" id="webhook-form" className="space-y-4">
            <input type="hidden" name="intent" value="save" />
            <input type="hidden" name="enabled" value={String(enabled)} />
            <label className="flex items-center gap-3">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              <span className="text-sm font-medium">Send submissions to a webhook</span>
            </label>
            <div className="space-y-2">
              <Label htmlFor="url">Endpoint URL</Label>
              <Input id="url" name="url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/formbucket" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="headers">Custom headers (optional)</Label>
              <Textarea
                id="headers"
                name="headers"
                value={headers}
                onChange={(e) => setHeaders(e.target.value)}
                rows={3}
                className="font-mono text-xs"
                placeholder={"Authorization: Bearer my-token"}
              />
              <p className="text-xs text-muted-foreground">One per line, as “Name: value”.</p>
            </div>
            {save.data?.error && <p className="text-sm text-destructive">{save.data.error}</p>}
          </save.Form>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <ResultButton type="submit" form="webhook-form" isSubmitting={saving} isSuccess={saved} loadingText="Saving..." successText="Saved">
              Save
            </ResultButton>
            <test.Form method="post">
              <input type="hidden" name="intent" value="test" />
              <Button type="submit" variant="outline" disabled={testing || !loaded.url}>
                <Send className="size-4" /> {testing ? "Sending..." : "Send test event"}
              </Button>
            </test.Form>
            {test.state === "idle" && test.data && (
              <span className={`text-sm ${test.data.success ? "text-green-600 dark:text-green-500" : "text-destructive"}`}>
                {test.data.success ? `Delivered (HTTP ${test.data.status})` : test.data.error}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Signing secret</CardTitle>
          <CardDescription>
            Every request carries an <InlineCode>X-FormBucket-Signature</InlineCode> header (HMAC-SHA256 of <InlineCode>timestamp.body</InlineCode>) so you can verify it came from here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loaded.secret ? (
            <div className="flex items-stretch gap-2">
              <code className="flex-1 rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
                {reveal ? loaded.secret : "•".repeat(28)}
              </code>
              <Button type="button" variant="outline" size="icon" className="h-auto" onClick={() => setReveal((r) => !r)} aria-label="Show or hide secret">
                {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
              <regen.Form method="post">
                <input type="hidden" name="intent" value="regenerate" />
                <Button type="submit" variant="outline" className="h-full" disabled={regen.state !== "idle"}>
                  <RefreshCw className="size-4" /> Regenerate
                </Button>
              </regen.Form>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">A secret is created the first time you save the webhook.</p>
          )}
          <CodeBlock code={verify} language="javascript" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payload</CardTitle>
          <CardDescription>
            POSTed as JSON with headers <InlineCode>X-FormBucket-Event</InlineCode>, <InlineCode>X-FormBucket-Delivery</InlineCode> and <InlineCode>X-FormBucket-Timestamp</InlineCode>. Reply with any 2xx to acknowledge.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock code={payload} language="json" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent deliveries</CardTitle>
        </CardHeader>
        <CardContent>
          {loaded.deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loaded.deliveries.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        <Badge variant={statusVariant[d.status]}>{d.status}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{d.event}</TableCell>
                      <TableCell>{d.attempts}</TableCell>
                      <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                        {d.response_status ? `HTTP ${d.response_status}` : ""} {d.error ?? ""}
                        {d.status === "pending" && d.next_attempt_at ? ` retry ${formatDistanceToNow(d.next_attempt_at, { addSuffix: true })}` : ""}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDistanceToNow(d.created_at, { addSuffix: true })}</TableCell>
                      <TableCell className="text-right">
                        <resend.Form method="post">
                          <input type="hidden" name="intent" value="resend" />
                          <input type="hidden" name="delivery" value={d.id} />
                          <Button type="submit" variant="ghost" size="sm" className="h-7 gap-1 text-xs" disabled={resend.state !== "idle"}>
                            <RotateCw className="size-3" /> Resend
                          </Button>
                        </resend.Form>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
