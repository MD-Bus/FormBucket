// IPv4 / IPv6 parsing and CIDR matching with BigInt. Pure functions so they can be unit-tested.

export type ParsedIp = { version: 4 | 6; value: bigint }
export type Cidr = { version: 4 | 6; network: bigint; prefix: number }

const BITS = { 4: 32, 6: 128 } as const

/** The broadest range an admin may block, so a typo cannot ban a large part of the internet. */
export const MIN_PREFIX = { 4: 16, 6: 32 } as const

function parseV4(input: string): bigint | null {
  const parts = input.split(".")
  if (parts.length !== 4) return null
  let value = 0n
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    value = (value << 8n) | BigInt(n)
  }
  return value
}

function parseV6(raw: string): bigint | null {
  let input = raw
  if (input.includes("%")) input = input.slice(0, input.indexOf("%")) // zone id
  if (!input.includes(":")) return null

  // Embedded IPv4 tail (::ffff:1.2.3.4) becomes two hex groups.
  const lastColon = input.lastIndexOf(":")
  const tail = input.slice(lastColon + 1)
  if (tail.includes(".")) {
    const v4 = parseV4(tail)
    if (v4 === null) return null
    input = `${input.slice(0, lastColon + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`
  }

  const halves = input.split("::")
  if (halves.length > 2) return null
  const parse = (s: string) => (s === "" ? [] : s.split(":"))
  const head = parse(halves[0])
  const rest = halves.length === 2 ? parse(halves[1]) : []
  if (halves.length === 1 && head.length !== 8) return null
  if (halves.length === 2 && head.length + rest.length > 7) return null
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - rest.length).fill("0"), ...rest] : head

  let value = 0n
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
    value = (value << 16n) | BigInt(parseInt(g, 16))
  }
  return value
}

/** Parses an address. IPv4-mapped IPv6 (::ffff:1.2.3.4) is treated as the IPv4 address it wraps. */
export function parseIp(raw: string): ParsedIp | null {
  const input = raw.trim().replace(/^\[|\]$/g, "")
  if (!input) return null
  if (!input.includes(":")) {
    const v = parseV4(input)
    return v === null ? null : { version: 4, value: v }
  }
  const v = parseV6(input)
  if (v === null) return null
  if (v >> 32n === 0xffffn) return { version: 4, value: v & 0xffffffffn }
  return { version: 6, value: v }
}

export function ipToString(ip: ParsedIp): string {
  if (ip.version === 4) return [24n, 16n, 8n, 0n].map((s) => String((ip.value >> s) & 255n)).join(".")
  const groups = Array.from({ length: 8 }, (_, i) => Number((ip.value >> BigInt((7 - i) * 16)) & 0xffffn))
  // RFC 5952: compress the longest run of zero groups (length >= 2), first one wins.
  let bestStart = -1
  let bestLen = 0
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++
      continue
    }
    let j = i
    while (j < 8 && groups[j] === 0) j++
    if (j - i > bestLen) [bestStart, bestLen] = [i, j - i]
    i = j
  }
  const hex = groups.map((g) => g.toString(16))
  if (bestLen < 2) return hex.join(":")
  return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLen).join(":")}`
}

function maskFor(version: 4 | 6, prefix: number): bigint {
  const bits = BITS[version]
  if (prefix === 0) return 0n
  return ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix)
}

/** Accepts "1.2.3.4", "1.2.3.0/24", "2001:db8::1", "2001:db8::/48". A bare address is a single-host range. */
export function parseCidr(raw: string): Cidr | null {
  const input = raw.trim()
  const slash = input.indexOf("/")
  const ip = parseIp(slash === -1 ? input : input.slice(0, slash))
  if (!ip) return null
  let prefix: number = BITS[ip.version]
  if (slash !== -1) {
    const p = input.slice(slash + 1)
    if (!/^\d{1,3}$/.test(p)) return null
    prefix = Number(p)
    if (input.includes(":") && ip.version === 4) prefix -= 96 // "::ffff:1.2.3.4/120" style
    if (prefix < 0 || prefix > BITS[ip.version]) return null
  }
  return { version: ip.version, network: ip.value & maskFor(ip.version, prefix), prefix }
}

export function cidrToString(c: Cidr): string {
  return `${ipToString({ version: c.version, value: c.network })}/${c.prefix}`
}

export function cidrContains(c: Cidr, ip: ParsedIp): boolean {
  return c.version === ip.version && (ip.value & maskFor(c.version, c.prefix)) === c.network
}

/**
 * What an automatic block should cover for a visitor: the exact IPv4 address, or the whole /64 for IPv6
 * (one subscriber usually controls an entire /64, so blocking a single IPv6 address achieves nothing).
 */
export function blockTargetFor(rawIp: string): string | null {
  const ip = parseIp(rawIp)
  if (!ip) return null
  return cidrToString(parseCidr(ip.version === 4 ? `${ipToString(ip)}/32` : `${ipToString(ip)}/64`)!)
}

export type BlockValidation = { ok: true; cidr: string; parsed: Cidr } | { ok: false; error: string }

/** Validates what an admin typed into the "block an address" box. */
export function validateBlockInput(raw: string): BlockValidation {
  const parsed = parseCidr(raw)
  if (!parsed) return { ok: false, error: `"${raw.trim().slice(0, 60)}" is not a valid IPv4/IPv6 address or range (for example 203.0.113.7, 203.0.113.0/24 or 2001:db8::/48).` }
  if (parsed.prefix < MIN_PREFIX[parsed.version]) {
    return {
      ok: false,
      error: `That range is too large. The broadest range you can block is /${MIN_PREFIX[parsed.version]} for IPv${parsed.version}.`,
    }
  }
  return { ok: true, cidr: cidrToString(parsed), parsed }
}
