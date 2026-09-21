import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("setup", "routes/setup.tsx"),
  route("forms", "routes/forms.tsx", [
    route("keys", "routes/forms.keys.tsx"),
    route("blocked-ips", "routes/forms.blocked-ips.tsx"),
    route(":formId", "routes/forms.$formId.tsx", [
      route("submissions", "routes/forms.$formId.submissions.tsx"),
      route("submissions/:submissionId", "routes/forms.$formId.submissions.$submissionId.tsx"),
      route("export", "routes/forms.$formId.export.tsx"),
      route("analytics", "routes/forms.$formId.analytics.tsx"),
      route("analytics/:kind", "routes/forms.$formId.analytics.$kind.tsx"),
      route("fields", "routes/forms.$formId.fields.tsx"),
      route("fields/:field", "routes/forms.$formId.fields.$field.tsx"),
      route("integration", "routes/forms.$formId.integration.tsx"),
      route("webhook", "routes/forms.$formId.webhook.tsx"),
      route("api", "routes/forms.$formId.api.tsx"),
      route("settings", "routes/forms.$formId.settings.tsx"),
    ]),
  ]),
] satisfies RouteConfig
