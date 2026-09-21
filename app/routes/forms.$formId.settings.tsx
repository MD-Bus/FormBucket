import { useEffect, useState } from "react"
import { data, redirect, useFetcher, useLoaderData } from "react-router"
import { Loader2 } from "lucide-react"
import type { Route } from "./+types/forms.$formId.settings"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { Button } from "#/components/ui/button"
import { Switch } from "#/components/ui/switch"
import { Textarea } from "#/components/ui/textarea"
import { NativeSelect } from "#/components/ui/native-select"
import { ResultButton } from "#/components/result-button"
import { InlineCode } from "#/components/code-block"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog"
import { requireAuth } from "~/server/auth.server"
import { getForm } from "~/server/forms.server"

export const meta: Route.MetaFunction = () => [{ title: "Settings | FormBucket" }]

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await getForm(env, params.formId)
  if (!form) throw new Response("Form not found", { status: 404 })
  return {
    form: {
      id: form.id,
      name: form.name,
      description: form.description,
      enabled: form.enabled,
      origins: form.allowed_origins.join("\n"),
      redirect: form.redirect_url ?? "",
      honeypot: form.honeypot_field,
      rateLimit: form.rate_limit_per_min,
      globalLimit: form.global_limit_per_min,
      turnstileEnabled: form.turnstile_enabled,
      turnstileSiteKey: form.turnstile_site_key ?? "",
      hasTurnstileSecret: Boolean(form.turnstile_secret), // the secret itself is never sent back to the browser
      honeypotBlock: { after: form.honeypot_block_after, hours: form.honeypot_block_hours },
      turnstileBlock: { after: form.turnstile_block_after, hours: form.turnstile_block_hours },
    },
  }
}

const ORIGIN_RE = /^(https?:\/\/)?(\*\.)?[a-z0-9.-]+(:\d+)?\/?$/i

export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const { formId } = params

  if (request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM forms WHERE id = ?").bind(formId).run()
    if (result.meta.changes === 0) return data({ success: false, error: "Form not found" }, { status: 404 })
    return redirect("/forms")
  }
  if (request.method !== "POST") return data({ success: false, error: "Method not allowed" }, { status: 405 })

  const body = await request.formData()
  const name = String(body.get("name") ?? "").trim().slice(0, 80)
  if (!name) return data({ success: false, error: "Form name is required" }, { status: 400 })

  const origins = String(body.get("origins") ?? "")
    .split(/[\n,]/)
    .map((o) => o.trim())
    .filter(Boolean)
  const badOrigin = origins.find((o) => !ORIGIN_RE.test(o))
  if (badOrigin) return data({ success: false, error: `"${badOrigin}" is not a valid origin. Use https://example.com or *.example.com` }, { status: 400 })
  if (origins.length > 50) return data({ success: false, error: "At most 50 allowed origins" }, { status: 400 })

  const redirectUrl = String(body.get("redirect") ?? "").trim()
  if (redirectUrl) {
    try {
      const u = new URL(redirectUrl)
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error()
    } catch {
      return data({ success: false, error: "Redirect URL must be a valid http(s) URL" }, { status: 400 })
    }
  }

  const honeypot = String(body.get("honeypot") ?? "").trim()
  if (honeypot && !/^[A-Za-z_][A-Za-z0-9_-]{0,40}$/.test(honeypot)) {
    return data({ success: false, error: "Honeypot field name may only contain letters, numbers, - and _" }, { status: 400 })
  }

  const rateLimit = Number(body.get("rate_limit") ?? 10)
  if (!Number.isInteger(rateLimit) || rateLimit < 0 || rateLimit > 10000) {
    return data({ success: false, error: "Rate limit must be a whole number between 0 and 10000" }, { status: 400 })
  }

  const globalLimit = Number(body.get("global_limit") ?? 120)
  if (!Number.isInteger(globalLimit) || globalLimit < 0 || globalLimit > 100000) {
    return data({ success: false, error: "Form-wide limit must be a whole number between 0 and 100000" }, { status: 400 })
  }

  // Turnstile
  const turnstileEnabled = body.get("turnstile_enabled") === "true"
  const siteKey = String(body.get("turnstile_site_key") ?? "").trim()
  const newSecret = String(body.get("turnstile_secret") ?? "").trim()
  if (siteKey && !/^[0-9A-Za-z_-]{6,100}$/.test(siteKey)) {
    return data({ success: false, error: "That Turnstile site key does not look right. Copy it from the Cloudflare dashboard." }, { status: 400 })
  }
  if (newSecret.length > 200) return data({ success: false, error: "That Turnstile secret is too long." }, { status: 400 })
  const existing = await env.DB.prepare("SELECT turnstile_secret FROM forms WHERE id = ?").bind(formId).first<{ turnstile_secret: string | null }>()
  if (turnstileEnabled && (!siteKey || !(newSecret || existing?.turnstile_secret))) {
    return data({ success: false, error: "Turnstile needs both a site key and a secret key before it can be switched on." }, { status: 400 })
  }

  // Automatic blocking: threshold + duration (hours; 0 = permanent)
  const parsePolicy = (prefix: "honeypot" | "turnstile", label: string) => {
    const after = Number(body.get(`${prefix}_block_after`) ?? 0)
    if (!Number.isInteger(after) || after < 0 || after > 1000) return { error: `${label}: the number of attempts must be between 0 and 1000` }
    const unit = String(body.get(`${prefix}_block_unit`) ?? "hours")
    const amount = Number(body.get(`${prefix}_block_amount`) ?? 24)
    if (unit === "forever") return { after, hours: 0 }
    if (!["hours", "days"].includes(unit) || !Number.isInteger(amount) || amount < 1) return { error: `${label}: enter how long to block for` }
    const hours = unit === "days" ? amount * 24 : amount
    if (hours > 24 * 365) return { error: `${label}: the longest timed block is 365 days (choose permanent instead)` }
    return { after, hours }
  }
  const honeypotPolicy = parsePolicy("honeypot", "Honeypot blocking")
  const turnstilePolicy = parsePolicy("turnstile", "Turnstile blocking")
  if ("error" in honeypotPolicy) return data({ success: false, error: honeypotPolicy.error }, { status: 400 })
  if ("error" in turnstilePolicy) return data({ success: false, error: turnstilePolicy.error }, { status: 400 })

  const result = await env.DB.prepare(
    `UPDATE forms SET name = ?, description = ?, enabled = ?, allowed_origins = ?, redirect_url = ?,
       honeypot_field = ?, rate_limit_per_min = ?, global_limit_per_min = ?,
       turnstile_enabled = ?, turnstile_site_key = ?, turnstile_secret = COALESCE(?, turnstile_secret),
       honeypot_block_after = ?, honeypot_block_hours = ?, turnstile_block_after = ?, turnstile_block_hours = ?,
       updated_at = ? WHERE id = ?`
  )
    .bind(
      name,
      String(body.get("description") ?? "").trim().slice(0, 300),
      body.get("enabled") === "true" ? 1 : 0,
      JSON.stringify(origins),
      redirectUrl || null,
      honeypot,
      rateLimit,
      globalLimit,
      turnstileEnabled ? 1 : 0,
      siteKey || null,
      newSecret || null,
      honeypotPolicy.after,
      honeypotPolicy.hours,
      turnstilePolicy.after,
      turnstilePolicy.hours,
      Date.now(),
      formId
    )
    .run()
  if (result.meta.changes === 0) return data({ success: false, error: "Form not found" }, { status: 404 })
  return data({ success: true })
}

type Policy = { after: string; amount: string; unit: "hours" | "days" | "forever" }

/** Stored as hours (0 = permanent); shown as the friendliest unit. */
function toPolicy({ after, hours }: { after: number; hours: number }): Policy {
  if (hours === 0) return { after: String(after), amount: "1", unit: "forever" }
  if (hours % 24 === 0) return { after: String(after), amount: String(hours / 24), unit: "days" }
  return { after: String(after), amount: String(hours), unit: "hours" }
}

function BlockPolicyFields({ name, label, value, onChange }: { name: "honeypot" | "turnstile"; label: string; value: Policy; onChange: (p: Policy) => void }) {
  const off = Number(value.after) === 0
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Block after</span>
        <Input name={`${name}_block_after`} type="number" min={0} value={value.after} onChange={(e) => onChange({ ...value, after: e.target.value })} className="w-20" aria-label={`${label}: attempts before blocking`} />
        <span className="text-muted-foreground">attempts within an hour, for</span>
        <Input
          name={`${name}_block_amount`}
          type="number"
          min={1}
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
          disabled={off || value.unit === "forever"}
          className="w-20"
          aria-label={`${label}: block duration`}
        />
        <div className="w-40">
          <NativeSelect name={`${name}_block_unit`} value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value as Policy["unit"] })} disabled={off} aria-label={`${label}: duration unit`}>
            <option value="hours">hours</option>
            <option value="days">days</option>
            <option value="forever">permanently</option>
          </NativeSelect>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{off ? "Off. Set a number of attempts to start blocking repeat offenders." : `A visitor who does this ${value.after} time${Number(value.after) === 1 ? "" : "s"} within an hour is blocked.`}</p>
    </div>
  )
}

export default function FormSettings() {
  const { form } = useLoaderData<typeof loader>()
  const update = useFetcher<{ success?: boolean; error?: string }>()
  const remove = useFetcher<{ success?: boolean; error?: string }>()

  const [name, setName] = useState(form.name)
  const [description, setDescription] = useState(form.description)
  const [enabled, setEnabled] = useState(form.enabled)
  const [origins, setOrigins] = useState(form.origins)
  const [redirectUrl, setRedirectUrl] = useState(form.redirect)
  const [honeypot, setHoneypot] = useState(form.honeypot)
  const [rateLimit, setRateLimit] = useState(String(form.rateLimit))
  const [globalLimit, setGlobalLimit] = useState(String(form.globalLimit))
  const [tsEnabled, setTsEnabled] = useState(form.turnstileEnabled)
  const [tsSiteKey, setTsSiteKey] = useState(form.turnstileSiteKey)
  const [tsSecret, setTsSecret] = useState("")
  const [hpPolicy, setHpPolicy] = useState(() => toPolicy(form.honeypotBlock))
  const [tsPolicy, setTsPolicy] = useState(() => toPolicy(form.turnstileBlock))
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmText, setConfirmText] = useState("")

  useEffect(() => {
    setName(form.name)
    setDescription(form.description)
    setEnabled(form.enabled)
    setOrigins(form.origins)
    setRedirectUrl(form.redirect)
    setHoneypot(form.honeypot)
    setRateLimit(String(form.rateLimit))
    setGlobalLimit(String(form.globalLimit))
    setTsEnabled(form.turnstileEnabled)
    setTsSiteKey(form.turnstileSiteKey)
    setTsSecret("")
    setHpPolicy(toPolicy(form.honeypotBlock))
    setTsPolicy(toPolicy(form.turnstileBlock))
  }, [form])

  const saving = update.state === "submitting"
  const saved = update.state === "idle" && update.data?.success === true
  const deleting = remove.state !== "idle"

  return (
    <div className="flex flex-1 flex-col gap-3">
      <update.Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="enabled" value={String(enabled)} />

        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
            <CardDescription>Name and status of this form.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Form name</Label>
              <Input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
              <p className="text-xs text-muted-foreground">
                The URL id <InlineCode>{form.id}</InlineCode> never changes, so renaming is safe.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input id="description" name="description" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <label className="flex items-center gap-3">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              <span className="text-sm">
                <span className="font-medium">Accepting submissions</span>
                <span className="block text-xs text-muted-foreground">Turn off to reject everything with a 403 while keeping your data.</span>
              </span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Spam &amp; access</CardTitle>
            <CardDescription>Keep bots and other websites from using your endpoint.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="origins">Allowed origins</Label>
              <Textarea
                id="origins"
                name="origins"
                value={origins}
                onChange={(e) => setOrigins(e.target.value)}
                rows={3}
                className="font-mono text-xs"
                placeholder={"https://example.com\n*.example.com"}
              />
              <p className="text-xs text-muted-foreground">
                One per line. Leave empty to accept submissions from anywhere. When set, requests must come from a browser on one of these sites.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="honeypot">Honeypot field</Label>
                <Input id="honeypot" name="honeypot" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} placeholder="_gotcha" className="font-mono" />
                <p className="text-xs text-muted-foreground">Hidden input bots tend to fill. Submissions that fill it are silently dropped.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rate_limit">Rate limit (per visitor, per minute)</Label>
                <Input id="rate_limit" name="rate_limit" type="number" min={0} value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} />
                <p className="text-xs text-muted-foreground">0 disables the limit.</p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="global_limit">Form-wide limit (all visitors, per minute)</Label>
                <Input id="global_limit" name="global_limit" type="number" min={0} value={globalLimit} onChange={(e) => setGlobalLimit(e.target.value)} className="sm:max-w-xs" />
                <p className="text-xs text-muted-foreground">
                  Backstop against floods from many different visitors: once this many submissions, rejections and blocked requests happen in one minute, further requests get a 429 and nothing more is written. Default 120, 0 disables it.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bot protection (Cloudflare Turnstile)</CardTitle>
            <CardDescription>
              A free, mostly invisible check that proves a real browser is sending the form. Add the widget to your form page (the Integration tab shows the snippet), and submissions without a valid check are rejected.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <input type="hidden" name="turnstile_enabled" value={String(tsEnabled)} />
            <label className="flex items-center gap-3">
              <Switch checked={tsEnabled} onCheckedChange={setTsEnabled} />
              <span className="text-sm">
                <span className="font-medium">Require Turnstile</span>
                <span className="block text-xs text-muted-foreground">Turn this on only after your form page includes the widget, or every submission will be rejected. Not usable for server-to-server posts.</span>
              </span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ts_site_key">Site key</Label>
                <Input id="ts_site_key" name="turnstile_site_key" value={tsSiteKey} onChange={(e) => setTsSiteKey(e.target.value)} placeholder="0x4AAAAAAA…" className="font-mono" autoComplete="off" />
                <p className="text-xs text-muted-foreground">Public. Goes into your form page.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ts_secret">Secret key</Label>
                <Input
                  id="ts_secret"
                  name="turnstile_secret"
                  type="password"
                  value={tsSecret}
                  onChange={(e) => setTsSecret(e.target.value)}
                  placeholder={form.hasTurnstileSecret ? "•••••••• (saved, leave empty to keep)" : "0x4AAAAAAA…"}
                  className="font-mono"
                  autoComplete="new-password"
                />
                <p className="text-xs text-muted-foreground">Private. Stored on your server, never shown again.</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Create a widget in the Cloudflare dashboard under <span className="text-foreground">Turnstile → Add widget</span>, add your website&apos;s domain, and copy both keys here.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Automatic blocking</CardTitle>
            <CardDescription>
              Block visitors who keep tripping your bot traps. Blocked addresses appear on the <span className="text-foreground">Blocked IPs</span> page, where you can unblock them. IPv6 visitors are blocked by their whole /64 network.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <BlockPolicyFields name="honeypot" label="Honeypot hits (a bot filled the hidden field)" value={hpPolicy} onChange={setHpPolicy} />
            <BlockPolicyFields name="turnstile" label="Failed Turnstile checks" value={tsPolicy} onChange={setTsPolicy} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>After submitting</CardTitle>
            <CardDescription>Where browsers go after a plain HTML form post. JSON requests always get a JSON response.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="redirect">Redirect URL</Label>
            <Input id="redirect" name="redirect" type="url" value={redirectUrl} onChange={(e) => setRedirectUrl(e.target.value)} placeholder="https://yoursite.com/thanks" />
            <p className="text-xs text-muted-foreground">Leave empty to show a simple built-in thank-you page.</p>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <ResultButton type="submit" isSubmitting={saving} isSuccess={saved} loadingText="Saving..." successText="Saved">
            Save changes
          </ResultButton>
          {update.data?.error && <p className="text-sm text-destructive">{update.data.error}</p>}
        </div>
        <p className="text-xs text-muted-foreground">Changes to the form reach the public endpoint within about 10 seconds.</p>
      </update.Form>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>Deleting a form permanently removes all of its submissions, analytics and webhook history.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete this form
          </Button>
        </CardContent>
      </Card>

      <Dialog open={deleteOpen} onOpenChange={(next) => !deleting && setDeleteOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{form.name}”?</DialogTitle>
            <DialogDescription>This cannot be undone. Type the form name to confirm.</DialogDescription>
          </DialogHeader>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={form.name} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting || confirmText !== form.name} onClick={() => remove.submit(null, { method: "delete" })}>
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Deleting...
                </>
              ) : (
                "Delete form"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
