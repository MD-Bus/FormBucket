import { redirect, useFetcher } from "react-router"
import type { Route } from "./+types/setup"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { requireAuth } from "~/server/auth.server"

export const meta: Route.MetaFunction = () => [{ title: "Create Your First Form | FormBucket" }]

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const existing = await env.DB.prepare("SELECT id FROM forms LIMIT 1").first()
  if (existing) return redirect("/forms")
  return {}
}

export default function Setup() {
  const fetcher = useFetcher<{ error?: string }>()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center space-y-4 text-center">
          <img src="/favicon.svg" alt="" className="size-12 rounded-xl" />
          <div className="space-y-2">
            <h1 className="text-3xl font-bold">Create Your First Form</h1>
            <p className="mt-2 text-muted-foreground">Start collecting submissions in seconds</p>
          </div>
        </div>

        <fetcher.Form method="post" action="/forms" className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">Form Name</Label>
            <Input id="name" name="name" placeholder="Contact Form" required autoFocus />
            {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
          </div>
          <Button type="submit" disabled={fetcher.state === "submitting"} className="w-full">
            {fetcher.state === "submitting" ? "Creating..." : "Create Form"}
          </Button>
        </fetcher.Form>
      </div>
    </div>
  )
}
