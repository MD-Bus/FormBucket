import { BarChart3, Database, ListChecks, Puzzle, Radio, Settings, Webhook } from "lucide-react"
import { NavLink, useLocation, useParams } from "react-router"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "#/components/ui/sidebar"

export function FormNav() {
  const { formId } = useParams()
  const location = useLocation()
  if (!formId) return null

  const items = [
    { title: "Submissions", path: "submissions", icon: Database },
    { title: "Analytics", path: "analytics", icon: BarChart3 },
    { title: "Fields", path: "fields", icon: ListChecks },
    { title: "Integration", path: "integration", icon: Puzzle },
    { title: "Webhook", path: "webhook", icon: Webhook },
    { title: "API", path: "api", icon: Radio },
    { title: "Settings", path: "settings", icon: Settings },
  ]

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Form</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const url = `/forms/${formId}/${item.path}`
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild isActive={location.pathname.startsWith(url)} tooltip={item.title}>
                  <NavLink to={url} prefetch="intent" className={({ isPending }) => (isPending ? "opacity-60" : undefined)}>
                    <item.icon />
                    <span>{item.title}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
