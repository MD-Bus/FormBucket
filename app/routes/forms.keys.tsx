import { useEffect, useState } from "react"
import { data, useFetcher, useLoaderData } from "react-router"
import { formatDistanceToNow } from "date-fns"
import { KeyRound, Plus, Trash2 } from "lucide-react"
import type { Route } from "./+types/forms.keys"
import { PageHeader } from "#/components/page-header"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { Badge } from "#/components/ui/badge"
import { NativeSelect } from "#/components/ui/native-select"
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog"
import { CopyField } from "#/components/code-block"
import { requireAuth } from "~/server/auth.server"
import { createApiKey } from "~/server/api.server"

export const meta: Route.MetaFunction = () => [{ title: "API keys | FormBucket" }]

type KeyRow = {
  id: string
  name: string
  prefix: string
  form_id: string | null
  form_name: string | null
  created_at: number
  last_used_at: number | null
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const [keys, forms] = await Promise.all([
    env.DB.prepare(
      `SELECT k.id, k.name, k.prefix, k.form_id, f.name AS form_name, k.created_at, k.last_used_at
       FROM api_keys k LEFT JOIN forms f ON f.id = k.form_id ORDER BY k.created_at DESC`
    ).all<KeyRow>(),
    env.DB.prepare("SELECT id, name FROM forms ORDER BY created_at ASC").all<{ id: string; name: string }>(),
  ])
  return { keys: keys.results, forms: forms.results }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const body = await request.formData()
  const intent = String(body.get("intent"))

  if (intent === "create") {
    const name = String(body.get("name") ?? "").trim().slice(0, 60)
    if (!name) return data({ error: "Give the key a name" }, { status: 400 })
    const scope = String(body.get("form") ?? "")
    let formId: string | null = null
    if (scope) {
      const exists = await env.DB.prepare("SELECT id FROM forms WHERE id = ?").bind(scope).first()
      if (!exists) return data({ error: "Form not found" }, { status: 404 })
      formId = scope
    }
    const { secret } = await createApiKey(env, name, formId)
    return data({ created: secret })
  }

  if (intent === "revoke") {
    await env.DB.prepare("DELETE FROM api_keys WHERE id = ?").bind(String(body.get("id"))).run()
    return data({ revoked: true })
  }

  return data({ error: "Unknown action" }, { status: 400 })
}

export default function KeysPage() {
  const { keys, forms } = useLoaderData<typeof loader>()
  const create = useFetcher<{ created?: string; error?: string }>()
  const revoke = useFetcher()
  const [revoking, setRevoking] = useState<KeyRow | null>(null)
  const [open, setOpen] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)

  useEffect(() => {
    if (revoke.state === "idle" && revoke.data) setRevoking(null)
  }, [revoke.state, revoke.data])

  useEffect(() => {
    if (create.state === "idle" && create.data?.created) {
      setSecret(create.data.created)
      setOpen(false)
    }
  }, [create.state, create.data])

  return (
    <>
      <PageHeader crumbs={[{ label: "FormBucket", to: "/forms" }, { label: "API keys" }]} />
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 pt-0">
        {secret && (
          <Alert>
            <KeyRound />
            <AlertTitle>Copy your new key now</AlertTitle>
            <AlertDescription className="w-full space-y-2">
              <p>This is the only time it is shown. Store it in your app&apos;s secrets.</p>
              <CopyField value={secret} />
              <Button size="sm" variant="outline" onClick={() => setSecret(null)}>
                Done
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle>API keys</CardTitle>
              <CardDescription>
                Keys for the pull API. They can read submissions and manage the position of their consumers (acknowledge, reset); they cannot change or delete submissions, forms or settings. Send as <code className="rounded bg-muted px-1 py-0.5 text-xs">Authorization: Bearer fbk_…</code>. Keys are stored hashed.
              </CardDescription>
            </div>
            <Button onClick={() => setOpen(true)} className="shrink-0">
              <Plus className="size-4" /> New key
            </Button>
          </CardHeader>
          <CardContent>
            {keys.length === 0 ? (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <KeyRound className="h-8 w-8" />
                  </EmptyMedia>
                  <EmptyTitle>No API keys</EmptyTitle>
                  <EmptyDescription>Create a key to let an app read new submissions.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={() => setOpen(true)}>Create a key</Button>
                </EmptyContent>
              </Empty>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Access</TableHead>
                      <TableHead>Last used</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.map((k) => (
                      <TableRow key={k.id}>
                        <TableCell className="font-medium">{k.name}</TableCell>
                        <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                        <TableCell>{k.form_id ? <Badge variant="secondary">{k.form_name ?? k.form_id}</Badge> : <Badge variant="outline">All forms</Badge>}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{k.last_used_at ? formatDistanceToNow(k.last_used_at, { addSuffix: true }) : "never"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDistanceToNow(k.created_at, { addSuffix: true })}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            aria-label={`Revoke ${k.name}`}
                            onClick={() => setRevoking(k)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
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

      <Dialog open={revoking !== null} onOpenChange={(next) => revoke.state === "idle" && !next && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke “{revoking?.name}”?</DialogTitle>
            <DialogDescription>Apps using this key will stop working immediately. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)} disabled={revoke.state !== "idle"}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={revoke.state !== "idle"}
              onClick={() => revoking && revoke.submit({ intent: "revoke", id: revoking.id }, { method: "post" })}
            >
              {revoke.state !== "idle" ? "Revoking..." : "Revoke key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>Keys read submissions and manage consumer cursors; they cannot edit or delete data. Scope a key to one form to limit the blast radius.</DialogDescription>
          </DialogHeader>
          <create.Form method="post">
            <input type="hidden" name="intent" value="create" />
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="key-name">Name</Label>
                <Input id="key-name" name="name" placeholder="n8n production" required autoFocus />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="key-form">Access</Label>
                <NativeSelect id="key-form" name="form" defaultValue="">
                  <option value="">All forms</option>
                  {forms.map((f) => (
                    <option key={f.id} value={f.id}>
                      Only “{f.name}”
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {create.data?.error && <p className="text-sm text-destructive">{create.data.error}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.state !== "idle"}>
                {create.state !== "idle" ? "Creating..." : "Create key"}
              </Button>
            </DialogFooter>
          </create.Form>
        </DialogContent>
      </Dialog>
    </>
  )
}
