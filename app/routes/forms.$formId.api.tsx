import { useLoaderData, useFetcher, Link } from "react-router"
import { formatDistanceToNow } from "date-fns"
import { data } from "react-router"
import { KeyRound, RotateCcw, Trash2 } from "lucide-react"
import type { Route } from "./+types/forms.$formId.api"
import { Button } from "#/components/ui/button"
import { Badge } from "#/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table"
import { CodeBlock, CopyField, InlineCode } from "#/components/code-block"
import { requireAuth } from "~/server/auth.server"
import { getForm } from "~/server/forms.server"

export const meta: Route.MetaFunction = () => [{ title: "API | FormBucket" }]

type ConsumerRow = {
  name: string
  cursor: number
  created_at: number
  last_pull_at: number | null
  last_ack_at: number | null
  pending: number
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await getForm(env, params.formId)
  if (!form) throw new Response("Form not found", { status: 404 })

  const consumers = await env.DB.prepare(
    `SELECT c.name, c.cursor, c.created_at, c.last_pull_at, c.last_ack_at,
      (SELECT COUNT(*) FROM submissions s WHERE s.form_id = c.form_id AND s.seq > c.cursor) AS pending
     FROM consumers c WHERE c.form_id = ? ORDER BY c.created_at ASC`
  )
    .bind(form.id)
    .all<ConsumerRow>()

  return { formId: form.id, origin: new URL(request.url).origin, consumers: consumers.results }
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const body = await request.formData()
  const intent = String(body.get("intent"))
  const name = String(body.get("name") ?? "")

  if (intent === "reset") {
    const to = body.get("to") === "latest" ? "latest" : "beginning"
    const row = await env.DB.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM submissions WHERE form_id = ?").bind(params.formId).first<{ m: number }>()
    await env.DB.prepare("UPDATE consumers SET cursor = ? WHERE form_id = ? AND name = ?")
      .bind(to === "latest" ? (row?.m ?? 0) : 0, params.formId, name)
      .run()
    return data({ success: true })
  }
  if (intent === "delete") {
    await env.DB.prepare("DELETE FROM consumers WHERE form_id = ? AND name = ?").bind(params.formId, name).run()
    return data({ success: true })
  }
  return data({ error: "Unknown action" }, { status: 400 })
}

function ConsumerActions({ name }: { name: string }) {
  const fetcher = useFetcher()
  const busy = fetcher.state !== "idle"
  return (
    <div className="flex justify-end gap-1">
      <fetcher.Form method="post">
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="intent" value="reset" />
        <input type="hidden" name="to" value="beginning" />
        <Button type="submit" variant="ghost" size="sm" className="h-7 gap-1 text-xs" disabled={busy} title="Replay everything from the first submission">
          <RotateCcw className="size-3" /> Replay all
        </Button>
      </fetcher.Form>
      <fetcher.Form method="post">
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="intent" value="reset" />
        <input type="hidden" name="to" value="latest" />
        <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs" disabled={busy} title="Skip everything up to now">
          Skip to latest
        </Button>
      </fetcher.Form>
      <fetcher.Form method="post">
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="intent" value="delete" />
        <Button type="submit" variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" disabled={busy} aria-label="Delete consumer">
          <Trash2 className="size-3.5" />
        </Button>
      </fetcher.Form>
    </div>
  )
}

export default function ApiPage() {
  const { formId, origin, consumers } = useLoaderData<typeof loader>()
  const base = `${origin}/api/v1/forms/${formId}`

  const curl = `# 1. Pull whatever is new for the reader named "n8n" (created on first use)
curl -H "Authorization: Bearer fbk_YOUR_KEY" \\
  "${base}/consumers/n8n/pull?limit=100"

# 2. Process the entries, then acknowledge up to the returned cursor
curl -X POST -H "Authorization: Bearer fbk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"cursor":"42"}' \\
  "${base}/consumers/n8n/ack"

# Shortcut: pull and acknowledge in one call (at-most-once)
curl -H "Authorization: Bearer fbk_YOUR_KEY" \\
  "${base}/consumers/n8n/pull?ack=true"

# Hold the request open up to 25 s until something arrives (near real-time)
curl -H "Authorization: Bearer fbk_YOUR_KEY" \\
  "${base}/consumers/n8n/pull?wait=25"`

  const js = `const API = '${base}'
const headers = { Authorization: 'Bearer ' + process.env.FORMBUCKET_KEY }

while (true) {
  // Long-poll: returns as soon as new entries exist, or after 25 s with an empty list
  const res = await fetch(\`\${API}/consumers/my-app/pull?wait=25&limit=100\`, { headers })
  const { data, cursor } = await res.json()

  for (const submission of data) {
    await handle(submission) // { id, seq, created_at, data, meta }
  }

  if (data.length > 0) {
    // Only acknowledge after successful processing: a crash means a retry, never data loss
    await fetch(\`\${API}/consumers/my-app/ack\`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cursor }),
    })
  }
}`

  const python = `import os, requests

API = "${base}"
HEADERS = {"Authorization": f"Bearer {os.environ['FORMBUCKET_KEY']}"}

while True:
    r = requests.get(f"{API}/consumers/my-app/pull", params={"wait": 25, "limit": 100}, headers=HEADERS, timeout=40)
    r.raise_for_status()
    body = r.json()
    for submission in body["data"]:
        handle(submission)
    if body["data"]:
        requests.post(f"{API}/consumers/my-app/ack", json={"cursor": body["cursor"]}, headers=HEADERS)`

  const stateless = `# Stateless: you keep the cursor yourself
curl -H "Authorization: Bearer fbk_YOUR_KEY" "${base}/submissions?after=0&limit=100"
# -> { "data": [...], "cursor": "42", "has_more": false }
curl -H "Authorization: Bearer fbk_YOUR_KEY" "${base}/submissions?after=42"`

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>Read submissions from your apps</CardTitle>
          <CardDescription>
            Give each app its own <strong>consumer</strong>. FormBucket remembers where it stopped, so every pull returns only entries it has not seen. Ideal for n8n, cron jobs and scripts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <CopyField value={base} />
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <KeyRound className="size-4" />
            Authenticate with an API key.
            <Button asChild variant="outline" size="sm">
              <Link to="/forms/keys">Manage API keys</Link>
            </Button>
          </div>
          <Tabs defaultValue="curl" className="w-full">
            <TabsList>
              <TabsTrigger value="curl">cURL</TabsTrigger>
              <TabsTrigger value="js">Node.js</TabsTrigger>
              <TabsTrigger value="python">Python</TabsTrigger>
              <TabsTrigger value="stateless">Stateless</TabsTrigger>
            </TabsList>
            <TabsContent value="curl" className="mt-3">
              <CodeBlock code={curl} language="bash" />
            </TabsContent>
            <TabsContent value="js" className="mt-3">
              <CodeBlock code={js} language="javascript" />
            </TabsContent>
            <TabsContent value="python" className="mt-3">
              <CodeBlock code={python} language="python" />
            </TabsContent>
            <TabsContent value="stateless" className="mt-3">
              <CodeBlock code={stateless} language="bash" />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Consumers</CardTitle>
          <CardDescription>Readers that have pulled from this form, and how far behind they are.</CardDescription>
        </CardHeader>
        <CardContent>
          {consumers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None yet. A consumer is created the first time an app calls <InlineCode>/consumers/&lt;name&gt;/pull</InlineCode>.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Unread</TableHead>
                    <TableHead>Cursor</TableHead>
                    <TableHead>Last pull</TableHead>
                    <TableHead>Last ack</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consumers.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="font-mono text-sm">{c.name}</TableCell>
                      <TableCell>
                        <Badge variant={c.pending === 0 ? "success" : "warning"}>{c.pending}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.cursor}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.last_pull_at ? formatDistanceToNow(c.last_pull_at, { addSuffix: true }) : "never"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.last_ack_at ? formatDistanceToNow(c.last_ack_at, { addSuffix: true }) : "never"}</TableCell>
                      <TableCell>
                        <ConsumerActions name={c.name} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reference</CardTitle>
          <CardDescription>All endpoints are relative to <InlineCode>{origin}/api/v1</InlineCode> and need a Bearer API key.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableBody>
                {[
                  ["GET", "/forms", "List forms with their field schemas"],
                  ["GET", "/forms/:id", "Form details and the latest cursor"],
                  ["GET", "/forms/:id/submissions?after=&limit=&since=&wait=", "Stateless listing, oldest first"],
                  ["GET", "/forms/:id/submissions/:submissionId", "One submission"],
                  ["GET", "/forms/:id/consumers/:name/pull?limit=&wait=&ack=&from=", "New entries since the last acknowledged cursor. from=latest starts at the end on first use"],
                  ["POST", "/forms/:id/consumers/:name/ack", "Body { cursor }. Moves the consumer forward"],
                  ["POST", "/forms/:id/consumers/:name/reset", "Body { cursor: 'beginning' | 'latest' | '<cursor>' } or { back: N } to replay the last N entries. A cursor past the latest entry is refused"],
                  ["GET", "/forms/:id/consumers", "List consumers"],
                  ["DELETE", "/forms/:id/consumers/:name", "Remove a consumer"],
                ].map(([method, path, desc]) => (
                  <TableRow key={method + path}>
                    <TableCell className="w-16">
                      <Badge variant={method === "GET" ? "secondary" : "outline"}>{method}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs whitespace-normal break-all">{path}</TableCell>
                    <TableCell className="text-sm whitespace-normal text-muted-foreground">{desc}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
