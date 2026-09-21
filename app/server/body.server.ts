export const MAX_BODY_BYTES = 1_000_000

/**
 * Reads a request body while enforcing a hard byte cap, no matter how the client
 * frames it (Content-Length, chunked, ...). Returns null when the cap is exceeded.
 */
export async function readCapped(request: Request, max = MAX_BODY_BYTES): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > max) return null
  if (!request.body) return new Uint8Array(0)

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

/** Keys that would change an object's prototype instead of storing a value. */
export const UNSAFE_KEYS = new Set(["__proto__"])

/**
 * Adds a field to a null-prototype record. Repeated keys become arrays, `__proto__` is dropped,
 * and built-in names such as `constructor` are treated like any other key.
 */
export function addField(target: Record<string, unknown>, key: string, value: unknown) {
  if (UNSAFE_KEYS.has(key)) return
  if (Object.hasOwn(target, key)) {
    const current = target[key]
    target[key] = Array.isArray(current) ? [...current, value] : [current, value]
  } else {
    target[key] = value
  }
}

export type ParsedBody =
  | { ok: true; data: Record<string, unknown>; fileFields: string[] }
  | { ok: false; status: number; message: string }

export async function parseBody(request: Request): Promise<ParsedBody> {
  const bytes = await readCapped(request)
  if (bytes === null) return { ok: false, status: 413, message: "Payload too large" }
  const type = (request.headers.get("content-type") ?? "").toLowerCase()
  const data: Record<string, unknown> = Object.create(null)
  const fileFields: string[] = []

  try {
    if (type.includes("application/x-www-form-urlencoded")) {
      for (const [k, v] of new URLSearchParams(new TextDecoder().decode(bytes))) addField(data, k, v)
      return { ok: true, data, fileFields }
    }
    if (type.includes("multipart/form-data")) {
      const form = await new Response(bytes as unknown as BodyInit, { headers: { "content-type": request.headers.get("content-type")! } }).formData()
      for (const [k, v] of form.entries()) {
        if (typeof v !== "string") {
          if ((v as File).size > 0) fileFields.push(k)
          continue
        }
        addField(data, k, v)
      }
      return { ok: true, data, fileFields }
    }

    const text = new TextDecoder().decode(bytes)
    if (!text.trim()) return { ok: false, status: 400, message: "Empty request body" }
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, status: 400, message: "Body must be a JSON object" }
    }
    for (const [k, v] of Object.entries(parsed)) addField(data, k, v)
    return { ok: true, data, fileFields }
  } catch {
    return { ok: false, status: 400, message: "Could not parse the request body" }
  }
}
