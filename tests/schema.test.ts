import { test } from "node:test"
import assert from "node:assert/strict"
import { inferFields, sanitizeFieldDefs, validateSubmission, type FieldDef } from "../app/lib/schema.ts"

const fields: FieldDef[] = [
  { name: "name", type: "text", required: true, min: 2, max: 50 },
  { name: "email", type: "email", required: true },
  { name: "age", type: "integer", required: false, min: 18, max: 120 },
  { name: "plan", type: "select", required: false, options: ["free", "pro"] },
  { name: "topics", type: "select", required: false, options: ["a", "b", "c"], multiple: true },
  { name: "agree", type: "boolean", required: false },
  { name: "site", type: "url", required: false },
  { name: "zip", type: "text", required: false, pattern: "^\\d{5}$", message: "ZIP must be 5 digits" },
]

test("accepts a valid submission and coerces types", () => {
  const r = validateSubmission(fields, "reject", { name: " Ada ", email: "ada@example.com", age: "36", agree: "on" })
  assert.ok(r.ok)
  assert.deepEqual(r.data, { name: "Ada", email: "ada@example.com", age: 36, agree: true })
})

test("reports required and format errors per field", () => {
  const r = validateSubmission(fields, "reject", { email: "nope" })
  assert.ok(!r.ok)
  const codes = Object.fromEntries(r.errors.map((e) => [e.field, e.code]))
  assert.equal(codes.name, "required")
  assert.equal(codes.email, "invalid_format")
})

test("rejects unknown fields in reject mode, strips in strip mode, keeps in keep mode", () => {
  const input = { name: "Ada", email: "ada@example.com", extra: "x" }
  const rej = validateSubmission(fields, "reject", input)
  assert.ok(!rej.ok && rej.errors.some((e) => e.code === "unknown_field" && e.field === "extra"))
  const strip = validateSubmission(fields, "strip", input)
  assert.ok(strip.ok && !("extra" in strip.data) && strip.stripped[0] === "extra")
  const keep = validateSubmission(fields, "keep", input)
  assert.ok(keep.ok && keep.data.extra === "x")
})

test("reserved _ keys are always dropped and never count as unknown", () => {
  const r = validateSubmission(fields, "reject", { name: "Ada", email: "a@b.co", _gotcha: "", _redirect: "x" })
  assert.ok(r.ok)
  assert.deepEqual(Object.keys(r.data).sort(), ["email", "name"])
})

test("schemaless forms accept anything", () => {
  const r = validateSubmission([], "reject", { whatever: 1, nested: { a: 1 } })
  assert.ok(r.ok && r.data.whatever === 1)
})

test("select, multiple select, url, pattern and range checks", () => {
  const bad = validateSubmission(fields, "reject", {
    name: "Ada", email: "a@b.co", plan: "gold", topics: ["a", "z"], site: "javascript:alert(1)", zip: "abc", age: "5",
  })
  assert.ok(!bad.ok)
  const codes = Object.fromEntries(bad.errors.map((e) => [e.field, e.code]))
  assert.equal(codes.plan, "invalid_option")
  assert.equal(codes.topics, "invalid_option")
  assert.equal(codes.site, "invalid_format")
  assert.equal(codes.zip, "pattern")
  assert.equal(codes.age, "too_small")
  assert.equal(bad.errors.find((e) => e.field === "zip")?.message, "ZIP must be 5 digits")

  const good = validateSubmission(fields, "reject", { name: "Ada", email: "a@b.co", topics: "a", plan: "pro", site: "https://x.dev" })
  assert.ok(good.ok)
  assert.deepEqual(good.data.topics, ["a"])
})

test("repeated urlencoded keys collapse for single-value fields", () => {
  assert.ok(validateSubmission(fields, "reject", { name: ["Ada"], email: "a@b.co" }).ok)
  assert.ok(!validateSubmission(fields, "reject", { name: ["Ada", "Bob"], email: "a@b.co" }).ok)
})

test("sanitizeFieldDefs validates names, types, regex and choices", () => {
  assert.ok(sanitizeFieldDefs([{ name: "ok", type: "text", required: true }]).fields)
  assert.ok(sanitizeFieldDefs([{ name: "_x", type: "text" }]).error)
  assert.ok(sanitizeFieldDefs([{ name: "a", type: "text" }, { name: "a", type: "text" }]).error)
  assert.ok(sanitizeFieldDefs([{ name: "a", type: "text", pattern: "(" }]).error)
  assert.ok(sanitizeFieldDefs([{ name: "a", type: "select", options: [] }]).error)
  assert.ok(sanitizeFieldDefs([{ name: "a", type: "number", min: 5, max: 1 }]).error)
})

test("inferFields guesses types from samples", () => {
  const inferred = inferFields([
    { email: "a@b.co", age: 3, ok: true, note: "hi" },
    { email: "c@d.co", age: 4, ok: false },
  ])
  const by = Object.fromEntries(inferred.map((f) => [f.name, f]))
  assert.equal(by.email.type, "email")
  assert.equal(by.age.type, "integer")
  assert.equal(by.ok.type, "boolean")
  assert.equal(by.note.required, false)
})
