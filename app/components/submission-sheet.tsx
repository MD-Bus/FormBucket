import { useEffect, useState } from "react"
import { useFetcher } from "react-router"
import { format, formatDistanceToNow } from "date-fns"
import { Loader2, RotateCw, Trash2 } from "lucide-react"
import { Button } from "#/components/ui/button"
import { Badge } from "#/components/ui/badge"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "#/components/ui/sheet"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog"
import { CopyButton } from "#/components/code-block"
import type { Submission } from "~/server/forms.server"

type Delivery = {
  id: string
  event: string
  url: string
  status: "pending" | "success" | "failed"
  attempts: number
  response_status: number | null
  error: string | null
  next_attempt_at: number | null
  updated_at: number
}

const statusVariant = { success: "success", pending: "warning", failed: "destructive" } as const

function display(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "object") return JSON.stringify(value, null, 2)
  return String(value)
}

export function SubmissionSheet({
  submission,
  onClose,
  onInspectField,
}: {
  submission: Submission | null
  onClose: () => void
  onInspectField: (name: string) => void
}) {
  const details = useFetcher<{ deliveries: Delivery[] }>()
  const remove = useFetcher<{ success?: boolean }>()
  const resend = useFetcher()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const base = submission ? `/forms/${submission.form_id}/submissions/${submission.id}` : null

  useEffect(() => {
    if (base) details.load(base)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base])

  // Refresh delivery status after a resend.
  useEffect(() => {
    if (base && resend.state === "idle" && resend.data) details.load(base)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resend.state])

  useEffect(() => {
    if (remove.state === "idle" && remove.data?.success) {
      setConfirmOpen(false)
      onClose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remove.state, remove.data])

  const deliveries = details.data?.deliveries ?? []
  const deleting = remove.state !== "idle"

  return (
    <>
      <Sheet open={submission !== null} onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {submission && (
            <>
              <SheetHeader>
                <SheetTitle>Submission</SheetTitle>
                <SheetDescription>
                  {format(submission.created_at, "PPpp")} · {formatDistanceToNow(submission.created_at, { addSuffix: true })}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-6 px-4">
                <section className="divide-y rounded-lg border">
                  {Object.keys(submission.data).length === 0 && (
                    <p className="p-3 text-sm text-muted-foreground">This submission is empty.</p>
                  )}
                  {Object.entries(submission.data).map(([key, value]) => (
                    <div key={key} className="group grid gap-1 p-3">
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => onInspectField(key)}
                          className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                          title="Open field insights"
                        >
                          {key}
                        </button>
                        <span className="opacity-0 transition-opacity group-hover:opacity-100">
                          <CopyButton text={display(value)} className="h-6 px-1.5" />
                        </span>
                      </div>
                      <p className="text-sm break-words whitespace-pre-wrap">{display(value) || <span className="text-muted-foreground">—</span>}</p>
                    </div>
                  ))}
                </section>

                <section className="space-y-2">
                  <h4 className="text-sm font-medium">Details</h4>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">ID</dt>
                    <dd className="font-mono text-xs break-all">{submission.id}</dd>
                    <dt className="text-muted-foreground">Cursor</dt>
                    <dd className="font-mono text-xs">{submission.seq}</dd>
                    <dt className="text-muted-foreground">Country</dt>
                    <dd>{submission.meta.country ?? "—"}</dd>
                    <dt className="text-muted-foreground">Device</dt>
                    <dd className="capitalize">{submission.meta.device ?? "—"}</dd>
                    <dt className="text-muted-foreground">Sent from</dt>
                    <dd className="break-all">{submission.meta.referrer ?? "—"}</dd>
                  </dl>
                </section>

                <section className="space-y-2">
                  <h4 className="text-sm font-medium">Webhook deliveries</h4>
                  {details.state === "loading" && !details.data ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : deliveries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No webhook was sent for this submission.</p>
                  ) : (
                    <ul className="space-y-2">
                      {deliveries.map((d) => (
                        <li key={d.id} className="rounded-lg border p-3 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <Badge variant={statusVariant[d.status]}>{d.status}</Badge>
                            <resend.Form method="post" action={base!}>
                              <input type="hidden" name="intent" value="resend" />
                              <input type="hidden" name="delivery" value={d.id} />
                              <Button type="submit" variant="ghost" size="sm" className="h-7 gap-1 text-xs" disabled={resend.state !== "idle"}>
                                <RotateCw className="size-3" /> Resend
                              </Button>
                            </resend.Form>
                          </div>
                          <p className="mt-2 text-xs break-all text-muted-foreground">{d.url}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {d.attempts} attempt{d.attempts === 1 ? "" : "s"}
                            {d.response_status ? ` · HTTP ${d.response_status}` : ""}
                            {d.error ? ` · ${d.error}` : ""}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              <SheetFooter>
                <Button variant="outline" className="text-destructive" onClick={() => setConfirmOpen(true)}>
                  <Trash2 className="size-4" /> Delete submission
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={confirmOpen} onOpenChange={(next) => !deleting && setConfirmOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete submission?</DialogTitle>
            <DialogDescription>This permanently removes the submission and its data. This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={() => base && remove.submit(null, { method: "delete", action: base })}>
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
