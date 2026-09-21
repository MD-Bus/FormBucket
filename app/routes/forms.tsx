import { Outlet, redirect, useLoaderData, type ShouldRevalidateFunctionArgs } from "react-router"
import type { Route } from "./+types/forms"
import type { FormSummary } from "#/types/form"
import { ShieldAlert } from "lucide-react"
import { AppSidebar } from "#/components/app-sidebar"
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert"
import { SidebarInset, SidebarProvider } from "#/components/ui/sidebar"
import { NavigationProgress } from "#/components/navigation-progress"
import { requireAuth, securityWarnings } from "~/server/auth.server"
import { RESERVED_FORM_IDS, slugify } from "~/server/forms.server"

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const session = await requireAuth(request, env)

  const result = await env.DB.prepare("SELECT id, name FROM forms ORDER BY created_at ASC").all<FormSummary>()
  const forms = result.results

  const pathname = new URL(request.url).pathname.replace(/\/$/, "")
  if (forms.length === 0 && pathname !== "/forms/keys" && pathname !== "/forms/blocked-ips") return redirect("/setup")
  if (pathname === "/forms") return redirect(`/forms/${forms[0].id}/submissions`)

  return { forms, username: session.username, warnings: securityWarnings(env) }
}

/**
 * The sidebar data (form list, user, warnings) only changes when a form is created or deleted.
 * React Router re-runs every parent loader on each click unless told otherwise, so opting out here
 * removes a whole set of database round trips from every navigation and every save.
 */
export function shouldRevalidate({ formAction, formMethod, nextUrl }: ShouldRevalidateFunctionArgs) {
  // Plain "/forms" is redirected to the first form by this loader, so it has to run.
  if (/^\/forms\/?$/.test(nextUrl.pathname)) return true
  if (!formAction) return false
  const createsForm = /^\/forms\/?(\?.*)?$/.test(formAction)
  const deletesForm = formMethod?.toUpperCase() === "DELETE" && /^\/forms\/[^/]+\/settings/.test(formAction)
  return createsForm || deletesForm ? true : false
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)

  const data = await request.formData()
  const name = String(data.get("name") ?? "").trim().slice(0, 80)
  if (!name) return { error: "Form name is required" }

  const id = slugify(name)
  if (!id) return { error: "Form name must contain letters or numbers" }
  if (RESERVED_FORM_IDS.has(id)) return { error: `"${id}" is a reserved name, please pick another` }

  const existing = await env.DB.prepare("SELECT id FROM forms WHERE id = ?").bind(id).first()
  if (existing) return { error: "A form with this name already exists" }

  const now = Date.now()
  await env.DB.prepare("INSERT INTO forms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .bind(id, name, now, now)
    .run()

  return redirect(`/forms/${id}/submissions`)
}

export default function Forms() {
  const { forms, username, warnings } = useLoaderData<typeof loader>()

  return (
    <SidebarProvider>
      <NavigationProgress />
      <AppSidebar forms={forms} username={username} />
      <SidebarInset>
        {warnings.length > 0 && (
          <Alert variant="destructive" className="mx-4 mt-4 w-auto">
            <ShieldAlert />
            <AlertTitle>Security recommendation</AlertTitle>
            <AlertDescription>{warnings.join(" ")}</AlertDescription>
          </Alert>
        )}
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
