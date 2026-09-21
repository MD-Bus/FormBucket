import type { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, BarChart3 } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { Button } from "#/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#/components/ui/tooltip"
import type { Submission } from "~/server/forms.server"

export function createColumns(
  submissions: Submission[],
  fieldOrder: string[],
  onInspectField: (name: string) => void
): ColumnDef<Submission>[] {
  const timeColumn: ColumnDef<Submission> = {
    accessorKey: "created_at",
    header: ({ column }) => (
      <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        Time
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const date = new Date(row.getValue("created_at") as number)
      return (
        <TooltipProvider delayDuration={1000}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-sm text-muted-foreground">{formatDistanceToNow(date, { addSuffix: true })}</div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    },
  }

  // Declared fields keep their order; anything else found in the data is appended.
  const names = new Set<string>(fieldOrder)
  const extra = new Set<string>()
  for (const s of submissions) for (const key of Object.keys(s.data)) if (!names.has(key)) extra.add(key)
  const sortedExtra = [...extra].sort((a, b) => (a === "email" ? -1 : b === "email" ? 1 : a.localeCompare(b)))

  const dataColumns: ColumnDef<Submission>[] = [...fieldOrder, ...sortedExtra].map((name) => ({
    id: name,
    accessorFn: (row) => row.data[name],
    header: () => (
      <div className="group flex items-center gap-1.5">
        <span>{name.charAt(0).toUpperCase() + name.slice(1)}</span>
        <button
          type="button"
          title={`Insights for ${name}`}
          aria-label={`Open insights for ${name}`}
          className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            onInspectField(name)
          }}
        >
          <BarChart3 className="size-3.5" />
        </button>
      </div>
    ),
    cell: ({ row }) => {
      const value = row.original.data[name]
      return <div className="text-sm">{value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value)}</div>
    },
  }))

  return [timeColumn, ...dataColumns]
}
