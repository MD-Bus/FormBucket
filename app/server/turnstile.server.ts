export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: "invalid" } // the visitor failed the check: counts as abuse
  | { ok: false; reason: "unavailable" | "misconfigured" } // our side or Cloudflare's: never counts against the visitor

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
const CONFIG_ERRORS = new Set(["missing-input-secret", "invalid-input-secret"])

/** Asks Cloudflare whether the token produced by the Turnstile widget is genuine. Tokens are single-use. */
export async function verifyTurnstile(secret: string, token: unknown): Promise<TurnstileResult> {
  const value = Array.isArray(token) ? token[0] : token
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return { ok: false, reason: "invalid" }

  let res: Response
  try {
    res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: value }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    return { ok: false, reason: "unavailable" }
  }
  // Cloudflare answers 400 with a JSON body for a wrong or missing secret, so read the body before judging the status.
  let body: { success?: boolean; "error-codes"?: string[] } | null = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (body?.success === true) return { ok: true }
  if ((body?.["error-codes"] ?? []).some((c) => CONFIG_ERRORS.has(c))) return { ok: false, reason: "misconfigured" }
  // A server error, or an answer we cannot read, is not the visitor's fault.
  if (!body || res.status >= 500) return { ok: false, reason: "unavailable" }
  return { ok: false, reason: "invalid" }
}
