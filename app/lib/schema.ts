// Field schema + validation. Pure functions (no Workers APIs) so they can be
// unit-tested and reused by the dashboard.

export const FIELD_TYPES = [
  "text",
  "textarea",
  "email",
  "number",
  "integer",
  "boolean",
  "url",
  "phone",
  "date",
  "select",
] as const
export type FieldType = (typeof FIELD_TYPES)[number]

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  textarea: "Long text",
  email: "Email",
  number: "Number",
  integer: "Integer",
  boolean: "Yes / No",
  url: "URL",
  phone: "Phone",
  date: "Date",
  select: "Choice",
}

export type FieldDef = {
  name: string
  label?: string
  type: FieldType
  required: boolean
  /** Length for text-like types, value for number/integer. */
  min?: number
  max?: number
  /** Regular expression the (string) value must match. */
  pattern?: string
  /** Allowed values for `select`. */
  options?: string[]
  /** `select` only: accept several values (checkbox groups). */
  multiple?: boolean
  /** Custom error message shown instead of the default. */
  message?: string
}

export type UnknownFieldsMode = "reject" | "strip" | "keep"

export type FieldError = { field: string; code: string; message: string }

export type ValidationResult =
  | { ok: true; data: Record<string, unknown>; stripped: string[] }
  | { ok: false; errors: FieldError[] }

export const FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
const DEFAULT_MAX_LENGTH = 5000
const TEXTAREA_MAX_LENGTH = 20000

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/
const PHONE_RE = /^\+?[0-9\s().-]{6,25}$/
const NUMBER_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

const TRUE_VALUES = new Set(["true", "on", "1", "yes", "y"])
const FALSE_VALUES = new Set(["false", "off", "0", "no", "n"])

function isMissing(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === "string") return value.trim() === ""
  if (Array.isArray(value)) return value.every(isMissing)
  return false
}

function fieldLabel(field: FieldDef): string {
  return field.label?.trim() || field.name
}

class Fail extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
  }
}

function validateValue(field: FieldDef, raw: unknown): unknown {
  const label = fieldLabel(field)

  if (field.type === "select") {
    const options = field.options ?? []
    const list = Array.isArray(raw) ? raw : [raw]
    const values = list.filter((v) => !isMissing(v)).map((v) => String(v).trim())
    if (values.length === 0) throw new Fail("required", `${label} is required`)
    if (!field.multiple && values.length > 1) {
      throw new Fail("invalid", `${label} accepts a single choice`)
    }
    for (const v of values) {
      if (!options.includes(v)) {
        throw new Fail("invalid_option", `${label} must be one of: ${options.join(", ")}`)
      }
    }
    return field.multiple ? [...new Set(values)] : values[0]
  }

  let value = raw
  if (Array.isArray(value)) {
    const present = value.filter((v) => !isMissing(v))
    if (present.length !== 1) throw new Fail("invalid_type", `${label} must be a single value`)
    value = present[0]
  }

  if (field.type === "boolean") {
    if (typeof value === "boolean") return value
    const s = String(value).trim().toLowerCase()
    if (TRUE_VALUES.has(s)) return true
    if (FALSE_VALUES.has(s)) return false
    throw new Fail("invalid_type", `${label} must be true or false`)
  }

  if (field.type === "number" || field.type === "integer") {
    let n: number
    if (typeof value === "number") n = value
    else if (typeof value === "string" && NUMBER_RE.test(value.trim())) n = Number(value.trim())
    else throw new Fail("invalid_type", `${label} must be a number`)
    if (!Number.isFinite(n)) throw new Fail("invalid_type", `${label} must be a number`)
    if (field.type === "integer" && !Number.isInteger(n)) {
      throw new Fail("invalid_type", `${label} must be a whole number`)
    }
    if (field.min !== undefined && n < field.min) {
      throw new Fail("too_small", `${label} must be at least ${field.min}`)
    }
    if (field.max !== undefined && n > field.max) {
      throw new Fail("too_large", `${label} must be at most ${field.max}`)
    }
    return n
  }

  // Everything below is string-based.
  if (typeof value === "number" || typeof value === "boolean") value = String(value)
  if (typeof value !== "string") throw new Fail("invalid_type", `${label} must be text`)
  const str = value.trim()

  const hardMax = field.type === "textarea" ? TEXTAREA_MAX_LENGTH : DEFAULT_MAX_LENGTH
  const max = Math.min(field.max ?? hardMax, hardMax)
  if (str.length > max) throw new Fail("too_long", `${label} must be at most ${max} characters`)
  if (field.min !== undefined && str.length < field.min) {
    throw new Fail("too_short", `${label} must be at least ${field.min} characters`)
  }

  switch (field.type) {
    case "email":
      if (str.length > 254 || !EMAIL_RE.test(str) || str.includes("..")) {
        throw new Fail("invalid_format", `${label} must be a valid email address`)
      }
      break
    case "url": {
      let ok = false
      try {
        const u = new URL(str)
        ok = (u.protocol === "http:" || u.protocol === "https:") && u.hostname.length > 0
      } catch {}
      if (!ok) throw new Fail("invalid_format", `${label} must be a valid http(s) URL`)
      break
    }
    case "phone":
      if (!PHONE_RE.test(str) || str.replace(/\D/g, "").length < 6) {
        throw new Fail("invalid_format", `${label} must be a valid phone number`)
      }
      break
    case "date":
      if (!DATE_RE.test(str) || Number.isNaN(Date.parse(str))) {
        throw new Fail("invalid_format", `${label} must be a valid date (YYYY-MM-DD)`)
      }
      break
  }

  if (field.pattern) {
    let re: RegExp | null = null
    try {
      re = new RegExp(field.pattern)
    } catch {}
    if (re && !re.test(str)) {
      throw new Fail("pattern", `${label} does not match the expected format`)
    }
  }

  return str
}

export function validateSubmission(
  fields: FieldDef[],
  mode: UnknownFieldsMode,
  input: Record<string, unknown>
): ValidationResult {
  // Keys starting with "_" are reserved for control values (honeypot etc.).
  // Null-prototype record: inherited names ("constructor", "toString") never count as values,
  // and "__proto__" is dropped so a payload cannot swap the record's prototype.
  const cleaned: Record<string, unknown> = Object.create(null)
  for (const [key, value] of Object.entries(input)) {
    if (!key.startsWith("_") && key !== "__proto__") cleaned[key] = value
  }

  // No schema defined: accept anything (schemaless bucket).
  if (fields.length === 0) return { ok: true, data: { ...cleaned }, stripped: [] }

  const errors: FieldError[] = []
  const data: Record<string, unknown> = {}

  for (const field of fields) {
    const raw = cleaned[field.name]
    if (isMissing(raw)) {
      if (field.required) {
        errors.push({
          field: field.name,
          code: "required",
          message: field.message || `${fieldLabel(field)} is required`,
        })
      }
      continue
    }
    try {
      data[field.name] = validateValue(field, raw)
    } catch (e) {
      if (!(e instanceof Fail)) throw e
      errors.push({ field: field.name, code: e.code, message: field.message || e.message })
    }
  }

  const known = new Set(fields.map((f) => f.name))
  const stripped: string[] = []
  for (const key of Object.keys(cleaned)) {
    if (known.has(key)) continue
    if (mode === "reject") {
      errors.push({ field: key, code: "unknown_field", message: `Unexpected field "${key}"` })
    } else if (mode === "strip") {
      stripped.push(key)
    } else {
      data[key] = cleaned[key]
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, data, stripped }
}

/** Validates and normalises a field list coming from the dashboard. */
export function sanitizeFieldDefs(
  raw: unknown
): { fields: FieldDef[]; error?: undefined } | { fields?: undefined; error: string } {
  if (!Array.isArray(raw)) return { error: "Fields must be a list" }
  if (raw.length > 60) return { error: "A form can have at most 60 fields" }

  const seen = new Set<string>()
  const fields: FieldDef[] = []

  for (const item of raw) {
    if (!item || typeof item !== "object") return { error: "Invalid field definition" }
    const f = item as Record<string, unknown>
    const name = typeof f.name === "string" ? f.name.trim() : ""
    if (!FIELD_NAME_RE.test(name)) {
      return {
        error: `Invalid field name "${name}". Use letters, numbers, "_", "-" or "." and start with a letter.`,
      }
    }
    if (seen.has(name)) return { error: `Duplicate field name "${name}"` }
    seen.add(name)

    const type = f.type as FieldType
    if (!FIELD_TYPES.includes(type)) return { error: `Unknown type for field "${name}"` }

    const def: FieldDef = { name, type, required: f.required === true }
    if (typeof f.label === "string" && f.label.trim()) def.label = f.label.trim().slice(0, 100)
    if (typeof f.message === "string" && f.message.trim()) def.message = f.message.trim().slice(0, 200)

    for (const key of ["min", "max"] as const) {
      const v = f[key]
      if (v === undefined || v === null || v === "") continue
      const n = Number(v)
      if (!Number.isFinite(n)) return { error: `"${key}" of field "${name}" must be a number` }
      def[key] = n
    }
    if (def.min !== undefined && def.max !== undefined && def.min > def.max) {
      return { error: `Field "${name}": min cannot be greater than max` }
    }

    if (typeof f.pattern === "string" && f.pattern.trim()) {
      if (f.pattern.length > 300) return { error: `Pattern of field "${name}" is too long` }
      try {
        new RegExp(f.pattern)
      } catch {
        return { error: `Pattern of field "${name}" is not a valid regular expression` }
      }
      def.pattern = f.pattern
    }

    if (type === "select") {
      const options = Array.isArray(f.options)
        ? [...new Set(f.options.map((o) => String(o).trim()).filter(Boolean))]
        : []
      if (options.length === 0) return { error: `Field "${name}" needs at least one choice` }
      if (options.length > 100 || options.some((o) => o.length > 200)) {
        return { error: `Field "${name}" has too many or too long choices` }
      }
      def.options = options
      def.multiple = f.multiple === true
    }

    fields.push(def)
  }
  return { fields }
}

/** Guess a field list from sample submissions (used by "infer from submissions"). */
export function inferFields(samples: Record<string, unknown>[]): FieldDef[] {
  const keys = new Map<string, unknown[]>()
  for (const s of samples) {
    for (const [k, v] of Object.entries(s)) {
      if (!FIELD_NAME_RE.test(k)) continue
      if (!keys.has(k)) keys.set(k, [])
      keys.get(k)!.push(v)
    }
  }
  const fields: FieldDef[] = []
  for (const [name, values] of keys) {
    const present = values.filter((v) => !isMissing(v))
    if (present.length === 0) continue
    const strings = present.map((v) => String(v))
    let type: FieldType = "text"
    if (present.every((v) => typeof v === "boolean")) type = "boolean"
    else if (present.every((v) => typeof v === "number" || NUMBER_RE.test(String(v)))) {
      type = present.every((v) => Number.isInteger(Number(v))) ? "integer" : "number"
    } else if (strings.every((s) => EMAIL_RE.test(s))) type = "email"
    else if (strings.every((s) => /^https?:\/\//i.test(s))) type = "url"
    else if (strings.every((s) => DATE_RE.test(s))) type = "date"
    else if (strings.some((s) => s.includes("\n") || s.length > 120)) type = "textarea"
    fields.push({ name, type, required: present.length === samples.length })
  }
  return fields
}
