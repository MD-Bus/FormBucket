import { test } from "node:test"
import assert from "node:assert/strict"
import { addField, parseBody, readCapped } from "../app/server/body.server.ts"
import { validateWebhookUrl } from "../app/server/webhook.server.ts"
import { dashboardCsp, withDashboardHeaders } from "../app/server/headers.server.ts"
import { validateSubmission } from "../app/lib/schema.ts"

const post = (body: BodyInit, headers: Record<string, string> = {}, duplex = false) =>
  new Request("https://x.test/f/a", { method: "POST", body, headers, ...(duplex ? { duplex: "half" } : {}) } as RequestInit)

function chunked(bytes: number, chunk = 64 * 1024): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream({
    pull(controller) {
      if (sent >= bytes) return controller.close()
      const n = Math.min(chunk, bytes - sent)
      controller.enqueue(new Uint8Array(n).fill(97))
      sent += n
    },
  })
}

test("body cap: declared Content-Length over the limit is refused", async () => {
  const big = "a".repeat(1_100_000)
  assert.equal(await readCapped(post(big)), null)
})

test("body cap: a chunked body with no Content-Length is cut off at the limit", async () => {
  const req = post(chunked(3_000_000), { "content-type": "application/x-www-form-urlencoded" }, true)
  assert.equal(req.headers.get("content-length"), null)
  assert.equal(await readCapped(req), null)
})

test("body cap: parseBody answers 413 for oversized urlencoded and multipart bodies", async () => {
  const urlenc = post(chunked(2_000_000), { "content-type": "application/x-www-form-urlencoded" }, true)
  const r1 = await parseBody(urlenc)
  assert.ok(!r1.ok && r1.status === 413)
  const multi = post(chunked(2_000_000), { "content-type": "multipart/form-data; boundary=x" }, true)
  const r2 = await parseBody(multi)
  assert.ok(!r2.ok && r2.status === 413)
})

test("body cap: normal bodies still parse", async () => {
  const r = await parseBody(post("name=Ada&tag=a&tag=b", { "content-type": "application/x-www-form-urlencoded" }))
  assert.ok(r.ok)
  assert.equal(r.data.name, "Ada")
  assert.deepEqual(r.data.tag, ["a", "b"])
  const j = await parseBody(post('{"a":1}', { "content-type": "application/json" }))
  assert.ok(j.ok && j.data.a === 1)
})

test("hostile keys: built-in names are plain values, __proto__ is dropped", async () => {
  const form = await parseBody(post("toString=a&constructor=b&hasOwnProperty=c&__proto__=d&ok=1", { "content-type": "application/x-www-form-urlencoded" }))
  assert.ok(form.ok)
  assert.equal(form.data.toString, "a")
  assert.equal(form.data.constructor, "b")
  assert.equal(form.data.hasOwnProperty, "c")
  assert.ok(!Object.hasOwn(form.data, "__proto__"))

  const json = await parseBody(post('{"__proto__":{"admin":true},"a":1}', { "content-type": "application/json" }))
  assert.ok(json.ok)
  assert.equal(Object.getPrototypeOf(json.data), null)
  assert.equal(({} as Record<string, unknown>).admin, undefined)
  assert.deepEqual(Object.keys(json.data), ["a"])

  const target = Object.create(null)
  addField(target, "x", 1)
  addField(target, "x", 2)
  assert.deepEqual(target.x, [1, 2])
})

test("hostile keys: a __proto__ payload cannot satisfy a required field", () => {
  const input = JSON.parse('{"__proto__":{"email":"a@b.co"}}')
  const r = validateSubmission([{ name: "email", type: "email", required: true }], "reject", input)
  assert.ok(!r.ok && r.errors.some((e) => e.field === "email" && e.code === "required"))
})

test("hostile keys: schemaless forms keep constructor/toString as ordinary data", () => {
  const input = Object.create(null)
  input.constructor = "x"
  input.toString = "y"
  const r = validateSubmission([], "keep", input)
  assert.ok(r.ok)
  assert.equal(r.data.constructor, "x")
  assert.equal(r.data.toString, "y")
})

test("webhook URLs: private, loopback, mapped-IPv6 and self-pointing targets are refused", () => {
  const blocked = [
    "http://localhost/x", "http://127.0.0.1/x", "http://2130706433/x", "http://[::1]/x", "http://[::ffff:127.0.0.1]/x",
    "http://[::ffff:7f00:1]/x", "http://[fe80::1]/x", "http://[fd00::1]/x", "http://10.0.0.5/x", "http://169.254.169.254/x",
    "http://192.168.1.1/x", "http://foo.internal/x", "http://localtest.me/x", "http://anything.nip.io/x", "http://lvh.me/x",
    "http://user:pw@example.com/x", "ftp://example.com/x",
  ]
  for (const u of blocked) assert.ok(validateWebhookUrl(u), `should block ${u}`)
  assert.ok(validateWebhookUrl("https://forms.example.workers.dev/f/contact", false, "forms.example.workers.dev"))
  assert.equal(validateWebhookUrl("https://hooks.example.com/formbucket", false, "forms.example.workers.dev"), null)
  assert.equal(validateWebhookUrl("http://localhost:5300/hook", true), null) // local development only
})

test("dashboard responses carry framing, sniffing, referrer and cache protections", () => {
  const res = withDashboardHeaders(new Response("ok"), new Request("https://x.test/forms"))
  assert.equal(res.headers.get("x-frame-options"), "DENY")
  assert.equal(res.headers.get("x-content-type-options"), "nosniff")
  assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin")
  assert.equal(res.headers.get("cache-control"), "no-store")
  assert.match(res.headers.get("strict-transport-security") ?? "", /max-age=31536000/)
  const http = withDashboardHeaders(new Response("ok"), new Request("http://localhost/forms"))
  assert.equal(http.headers.get("strict-transport-security"), null)
})

test("CSP: nonce-only scripts, no framing, no plugins", () => {
  const csp = dashboardCsp("abc123")
  assert.match(csp, /script-src 'self' 'nonce-abc123'/)
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp))
  assert.match(csp, /frame-ancestors 'none'/)
  assert.match(csp, /object-src 'none'/)
  assert.match(csp, /form-action 'self'/)
})

import { splitStatements } from "../app/server/migrate.server.ts"

test("migrations: SQL files split into single statements without comments", () => {
  const sql = `-- header comment
ALTER TABLE forms ADD COLUMN x INTEGER NOT NULL DEFAULT 1;   -- trailing comment

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,   -- inline comment with ; semicolon
    cred TEXT NOT NULL
);
CREATE INDEX idx_s ON sessions(id);
`
  const out = splitStatements(sql)
  assert.equal(out.length, 3)
  assert.match(out[0], /^ALTER TABLE forms ADD COLUMN x/)
  assert.match(out[1], /^CREATE TABLE sessions/)
  assert.ok(!out.join(" ").includes("comment"))
})

import { verifyTurnstile } from "../app/server/turnstile.server.ts"

const withFetch = async (impl: typeof fetch, run: () => Promise<void>) => {
  const original = globalThis.fetch
  globalThis.fetch = impl
  try {
    await run()
  } finally {
    globalThis.fetch = original
  }
}
const reply = (status: number, body: unknown) => (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch

test("turnstile: a genuine token passes, and the secret is sent to Cloudflare, not logged elsewhere", async () => {
  let sent = ""
  await withFetch((async (_url: unknown, init: RequestInit) => {
    sent = String(init.body)
    return new Response(JSON.stringify({ success: true }))
  }) as unknown as typeof fetch, async () => {
    assert.deepEqual(await verifyTurnstile("sekret", "tok-1"), { ok: true })
  })
  assert.match(sent, /secret=sekret/)
  assert.match(sent, /response=tok-1/)
})

test("turnstile: a failed check counts against the visitor; our own problems never do", async () => {
  await withFetch(reply(200, { success: false, "error-codes": ["invalid-input-response"] }), async () => {
    assert.deepEqual(await verifyTurnstile("s", "tok"), { ok: false, reason: "invalid" })
  })
  // Cloudflare answers 400 + JSON for a bad secret: that is OUR misconfiguration.
  await withFetch(reply(400, { success: false, "error-codes": ["invalid-input-secret"] }), async () => {
    assert.deepEqual(await verifyTurnstile("bad", "tok"), { ok: false, reason: "misconfigured" })
  })
  await withFetch(reply(500, "oops"), async () => {
    assert.deepEqual(await verifyTurnstile("s", "tok"), { ok: false, reason: "unavailable" })
  })
  await withFetch(reply(200, "not json"), async () => {
    assert.deepEqual(await verifyTurnstile("s", "tok"), { ok: false, reason: "unavailable" })
  })
  await withFetch((async () => {
    throw new Error("network down")
  }) as unknown as typeof fetch, async () => {
    assert.deepEqual(await verifyTurnstile("s", "tok"), { ok: false, reason: "unavailable" })
  })
})

test("turnstile: a missing or absurd token fails without calling Cloudflare", async () => {
  let calls = 0
  await withFetch((async () => {
    calls++
    return new Response("{}")
  }) as unknown as typeof fetch, async () => {
    for (const bad of [undefined, null, "", 42, "x".repeat(3000), []]) {
      assert.deepEqual(await verifyTurnstile("s", bad), { ok: false, reason: "invalid" })
    }
    assert.deepEqual(await verifyTurnstile("s", ["tok"]), { ok: false, reason: "invalid" }) // still needs Cloudflare's OK below
  })
  assert.equal(calls, 1, "only the well-formed array token reaches Cloudflare")
})
