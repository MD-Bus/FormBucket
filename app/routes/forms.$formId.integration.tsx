import { useLoaderData } from "react-router"
import type { Route } from "./+types/forms.$formId.integration"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs"
import { CodeBlock, CopyField, InlineCode } from "#/components/code-block"
import type { FieldDef } from "#/lib/schema"
import { requireAuth } from "~/server/auth.server"
import { getForm } from "~/server/forms.server"

export const meta: Route.MetaFunction = () => [{ title: "Integration | FormBucket" }]

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await getForm(env, params.formId)
  if (!form) throw new Response("Form not found", { status: 404 })
  return {
    formId: form.id,
    fields: form.fields,
    enforced: form.schema_enforced,
    honeypot: form.honeypot_field,
    turnstileSiteKey: form.turnstile_enabled ? form.turnstile_site_key : null,
    redirect: form.redirect_url,
    origins: form.allowed_origins,
    origin: new URL(request.url).origin,
  }
}

const inputType: Record<string, string> = { email: "email", number: "number", integer: "number", url: "url", phone: "tel", date: "date" }

function htmlInput(f: FieldDef): string {
  const req = f.required ? " required" : ""
  const label = f.label || f.name
  if (f.type === "textarea") return `  <textarea name="${f.name}" placeholder="${label}"${req}></textarea>`
  if (f.type === "boolean") return `  <label><input type="checkbox" name="${f.name}" value="true" /> ${label}</label>`
  if (f.type === "select") {
    const opts = (f.options ?? []).map((o) => `    <option value="${o}">${o}</option>`).join("\n")
    return `  <select name="${f.name}"${f.multiple ? " multiple" : ""}${req}>\n${opts}\n  </select>`
  }
  const extra = [
    f.type === "integer" ? ' step="1"' : "",
    f.min !== undefined ? (inputType[f.type] === "number" ? ` min="${f.min}"` : ` minlength="${f.min}"`) : "",
    f.max !== undefined ? (inputType[f.type] === "number" ? ` max="${f.max}"` : ` maxlength="${f.max}"`) : "",
    f.pattern ? ` pattern="${f.pattern.replace(/"/g, "&quot;")}"` : "",
  ].join("")
  return `  <input type="${inputType[f.type] ?? "text"}" name="${f.name}" placeholder="${label}"${extra}${req} />`
}

export default function IntegrationPage() {
  const { formId, fields, enforced, honeypot, turnstileSiteKey, redirect, origins, origin } = useLoaderData<typeof loader>()
  const endpoint = `${origin}/f/${formId}`

  const sampleFields: FieldDef[] =
    fields.length > 0
      ? fields
      : [
          { name: "name", type: "text", required: true },
          { name: "email", type: "email", required: true },
          { name: "message", type: "textarea", required: false },
        ]

  const sampleData = Object.fromEntries(
    sampleFields.map((f) => [
      f.name,
      f.type === "email" ? "jane@example.com" : f.type === "boolean" ? true : f.type === "number" || f.type === "integer" ? 42 : f.type === "select" ? (f.options?.[0] ?? "") : f.type === "url" ? "https://example.com" : f.type === "phone" ? "+1 555 010 0100" : f.type === "date" ? "2026-01-31" : "Hello!",
    ])
  )

  const html = `<form action="${endpoint}" method="POST">
${sampleFields.map(htmlInput).join("\n")}
${honeypot ? `  <!-- Spam trap: real people never see or fill this field -->\n  <input type="text" name="${honeypot}" style="display:none" tabindex="-1" autocomplete="off" />\n` : ""}${turnstileSiteKey ? `  <!-- Cloudflare Turnstile: adds the hidden "cf-turnstile-response" field automatically -->\n  <div class="cf-turnstile" data-sitekey="${turnstileSiteKey}"></div>\n` : ""}  <button type="submit">Send</button>
</form>${turnstileSiteKey ? `\n<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ""}`

  const js = `const res = await fetch('${endpoint}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(${JSON.stringify(turnstileSiteKey ? { ...sampleData, "cf-turnstile-response": "<token from turnstile.getResponse()>" } : sampleData, null, 2).replace(/\n/g, "\n  ")}),
})

const result = await res.json()
if (res.ok) {
  console.log('Received', result.id)
} else {
  // 422: result.errors = [{ field, code, message }]
  console.error(result.errors)
}`

  const curl = `curl -X POST '${endpoint}' \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify(sampleData)}'`

  const tracker = `<script src="${origin}/f/${formId}/track.js" defer></script>`

  return (
    <div className="flex flex-1 flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>Endpoint</CardTitle>
          <CardDescription>
            Use this as your HTML form <InlineCode>action</InlineCode> URL, or POST JSON to it. Browsers and servers both work.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <CopyField value={endpoint} />
          <p className="text-xs text-muted-foreground">
            {origins.length > 0 ? `Only accepts browser requests from: ${origins.join(", ")}.` : "Accepts requests from any website. Restrict this in Settings."}{" "}
            {redirect ? `HTML posts redirect to ${redirect}.` : "HTML posts show a default thank-you page unless you set a redirect URL in Settings."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Send data</CardTitle>
          <CardDescription>
            {fields.length === 0
              ? "Examples use sample fields. Define a schema in Fields to tailor them."
              : enforced
                ? "Examples are generated from your field schema, which is enforced: non-matching submissions are rejected."
                : "Examples are generated from your field schema. It is not enforced, so every submission is accepted."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="html" className="w-full">
            <TabsList>
              <TabsTrigger value="html">HTML</TabsTrigger>
              <TabsTrigger value="javascript">JavaScript</TabsTrigger>
              <TabsTrigger value="curl">cURL</TabsTrigger>
            </TabsList>
            <TabsContent value="html" className="mt-3">
              <CodeBlock code={html} language="markup" />
            </TabsContent>
            <TabsContent value="javascript" className="mt-3">
              <CodeBlock code={js} language="javascript" />
            </TabsContent>
            <TabsContent value="curl" className="mt-3">
              <CodeBlock code={curl} language="bash" />
            </TabsContent>
          </Tabs>
          <div className="mt-4 space-y-1 text-sm text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Success:</span> <InlineCode>200 {"{ ok: true, id }"}</InlineCode> for JSON, or a redirect for HTML posts.
            </p>
            <p>
              <span className="font-medium text-foreground">Invalid:</span> <InlineCode>422 {"{ ok: false, errors: [{ field, code, message }] }"}</InlineCode>
            </p>
            <p>
              <span className="font-medium text-foreground">Other:</span> <InlineCode>403</InlineCode> origin not allowed or form disabled, <InlineCode>429</InlineCode> rate limited.
            </p>
          </div>
        </CardContent>
      </Card>

      {turnstileSiteKey && (
        <Card>
          <CardHeader>
            <CardTitle>Turnstile is required for this form</CardTitle>
            <CardDescription>
              Submissions without a valid Turnstile check are rejected. Add the widget inside your form and load its script once on the page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <CodeBlock
              code={`<div class="cf-turnstile" data-sitekey="${turnstileSiteKey}"></div>\n<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`}
              language="markup"
            />
            <p className="text-xs text-muted-foreground">
              A plain HTML form sends the token by itself. With <InlineCode>fetch</InlineCode>, read it with <InlineCode>turnstile.getResponse()</InlineCode> and send it as the field <InlineCode>cf-turnstile-response</InlineCode>. Each token works once, so reset the widget after a submission. The cURL example cannot pass this check.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Analytics snippet (optional)</CardTitle>
          <CardDescription>
            Add this to the page that shows the form to track views, started forms and conversion. No cookies, no raw IPs stored.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <CodeBlock code={tracker} language="markup" />
          <p className="text-xs text-muted-foreground">
            “Started” fires when someone focuses a field in a form that posts to this endpoint, or any form with a{" "}
            <InlineCode>data-formbucket</InlineCode> attribute.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
