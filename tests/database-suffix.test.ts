import { test } from "node:test"
import assert from "node:assert/strict"
// @ts-expect-error plain .mjs build script
import { applyDatabaseSuffix } from "../scripts/set-database-suffix.mjs"

const base = (name = "formbucket") => ({ name, d1_databases: [{ binding: "DB", migrations_dir: "../../migrations" }] })

test("DB_SUFFIX unset or blank leaves the config untouched (default <worker>-db naming)", () => {
  for (const v of [undefined, "", "   "]) {
    const r = applyDatabaseSuffix(base(), v)
    assert.equal(r.changed, false)
    assert.equal(r.config.d1_databases[0].database_name, undefined)
  }
})

test("the suffix is appended to the Worker name", () => {
  const r = applyDatabaseSuffix(base(), "  x7k2 ")
  assert.equal(r.changed, true)
  assert.equal(r.name, "formbucket-x7k2")
  assert.equal(r.config.d1_databases[0].database_name, "formbucket-x7k2")
  assert.equal(r.config.d1_databases[0].binding, "DB")
})

test("it follows a renamed Worker and normalises case and underscores", () => {
  assert.equal(applyDatabaseSuffix(base("formbucketlive"), "Prod_01").name, "formbucketlive-prod-01")
})

test("invalid suffixes fail the build with a clear message", () => {
  for (const bad of ["-nope", "has space", "semi;colon", "x".repeat(33), "emoji😀"]) {
    assert.throws(() => applyDatabaseSuffix(base(), bad), /DB_SUFFIX .* is not valid/)
  }
})

test("a config without the DB binding is reported, not silently ignored", () => {
  assert.throws(() => applyDatabaseSuffix({ name: "x", d1_databases: [] }, "abc"), /"DB" D1 binding/)
})
