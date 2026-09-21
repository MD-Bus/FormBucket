import { Outlet, redirect, useLoaderData, useLocation, type ShouldRevalidateFunctionArgs } from "react-router"
import type { Route } from "./+types/forms.$formId"
import { PageHeader } from "#/components/page-header"
import { requireAuth } from "~/server/auth.server"
import { getForm } from "~/server/forms.server"

const TITLES: Record<string, string> = {
  submissions: "Submissions",
  analytics: "Analytics",
  fields: "Fields",
  integration: "Integration",
  webhook: "Webhook",
  api: "API",
  settings: "Settings",
}

/**
 * The form name in the breadcrumb only changes when the settings are saved or another form is opened.
 * Skipping this loader on ordinary clicks saves a database round trip each time.
 */
export function shouldRevalidate({ formAction, currentParams, nextParams, nextUrl }: ShouldRevalidateFunctionArgs) {
  if (currentParams.formId !== nextParams.formId) return true
  // "/forms/:id" on its own is redirected to the submissions page by this loader.
  if (nextUrl.pathname.replace(/\/$/, "") === `/forms/${nextParams.formId}`) return true
  return Boolean(formAction && /\/settings(\?.*)?$/.test(formAction))
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)

  // Same lookup the page loader does; getForm shares one query between them.
  const found = await getForm(env, params.formId)
  if (!found) throw new Response("Form not found", { status: 404 })
  const form = { id: found.id, name: found.name }

  const pathname = new URL(request.url).pathname.replace(/\/$/, "")
  if (pathname === `/forms/${params.formId}`) return redirect(`/forms/${params.formId}/submissions`)

  return { form }
}

export default function FormLayout() {
  const { form } = useLoaderData<typeof loader>()
  const location = useLocation()
  const page = location.pathname.split("/").filter(Boolean)[2]

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "FormBucket", to: "/forms" },
          { label: form.name, to: `/forms/${form.id}/submissions` },
          { label: TITLES[page] ?? "Form" },
        ]}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 pt-0">
        <Outlet />
      </div>
    </>
  )
}
