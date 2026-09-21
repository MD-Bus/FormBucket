import { test } from "node:test"
import assert from "node:assert/strict"
import { blockTargetFor, cidrContains, cidrToString, ipToString, parseCidr, parseIp, validateBlockInput } from "../app/lib/ip.ts"

const s = (raw: string) => {
  const ip = parseIp(raw)
  return ip ? ipToString(ip) : null
}

test("IPv4 parsing: valid, invalid and ambiguous forms", () => {
  assert.equal(s("203.0.113.7"), "203.0.113.7")
  assert.equal(s(" 1.2.3.4 "), "1.2.3.4")
  for (const bad of ["", "1.2.3", "1.2.3.4.5", "256.1.1.1", "1.2.3.-1", "01.2.3.4", "1.2.3.04", "a.b.c.d", "1..2.3"]) {
    assert.equal(parseIp(bad), null, bad)
  }
})

test("IPv6 parsing: compression, case, brackets, zones, embedded IPv4", () => {
  assert.equal(s("2001:0db8:0000:0000:0000:0000:0000:0001"), "2001:db8::1")
  assert.equal(s("2001:DB8::1"), "2001:db8::1")
  assert.equal(s("[2001:db8::1]"), "2001:db8::1")
  assert.equal(s("fe80::1%eth0"), "fe80::1")
  assert.equal(s("::1"), "::1")
  assert.equal(s("::"), "::")
  assert.equal(s("1:0:0:2:0:0:0:3"), "1:0:0:2::3") // longest zero run is compressed
  assert.equal(s("2001:db8:0:1:1:1:1:1"), "2001:db8:0:1:1:1:1:1") // a single zero group is not compressed
  for (const bad of ["1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "1::2::3", "12345::1", "g::1", ":::", "1:2:3:4:5:6:7::8:9"]) {
    assert.equal(parseIp(bad), null, bad)
  }
})

test("IPv4-mapped IPv6 is treated as the IPv4 address", () => {
  const ip = parseIp("::ffff:203.0.113.7")
  assert.deepEqual(ip && { v: ip.version, s: ipToString(ip) }, { v: 4, s: "203.0.113.7" })
  assert.equal(s("::ffff:cb00:7107"), "203.0.113.7")
})

test("CIDR: normalisation and containment", () => {
  assert.equal(cidrToString(parseCidr("203.0.113.77/24")!), "203.0.113.0/24")
  assert.equal(cidrToString(parseCidr("203.0.113.7")!), "203.0.113.7/32")
  assert.equal(cidrToString(parseCidr("2001:db8:1234:5678:9abc::1/64")!), "2001:db8:1234:5678::/64")
  const net = parseCidr("203.0.113.0/24")!
  assert.ok(cidrContains(net, parseIp("203.0.113.200")!))
  assert.ok(!cidrContains(net, parseIp("203.0.114.1")!))
  const v6 = parseCidr("2001:db8::/32")!
  assert.ok(cidrContains(v6, parseIp("2001:db8:ffff::5")!))
  assert.ok(!cidrContains(v6, parseIp("2001:db9::1")!))
  assert.ok(!cidrContains(net, parseIp("2001:db8::1")!), "versions never match each other")
  assert.ok(cidrContains(parseCidr("0.0.0.0/0")!, parseIp("8.8.8.8")!))
  for (const bad of ["1.2.3.4/33", "1.2.3.4/-1", "1.2.3.4/x", "2001:db8::/129", "1.2.3.4/", "nope/24"]) assert.equal(parseCidr(bad), null, bad)
})

test("automatic blocks cover the exact IPv4 address or the whole IPv6 /64", () => {
  assert.equal(blockTargetFor("203.0.113.7"), "203.0.113.7/32")
  assert.equal(blockTargetFor("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "2001:db8:1:2::/64")
  assert.equal(blockTargetFor("::ffff:203.0.113.7"), "203.0.113.7/32")
  assert.equal(blockTargetFor("not an ip"), null)
  const block = parseCidr(blockTargetFor("2001:db8:1:2:aaaa:bbbb:cccc:dddd")!)!
  assert.ok(cidrContains(block, parseIp("2001:db8:1:2:1::9")!), "another address in the same /64 is covered")
})

test("manual block input: accepted forms and safety limits", () => {
  for (const ok of ["203.0.113.7", "203.0.113.0/24", "10.0.0.0/16", "2001:db8::/32", "2001:db8::1"]) {
    assert.ok(validateBlockInput(ok).ok, ok)
  }
  const tooBroad = validateBlockInput("10.0.0.0/8")
  assert.ok(!tooBroad.ok && /too large/.test(tooBroad.error))
  assert.ok(!validateBlockInput("2000::/16").ok)
  assert.ok(!validateBlockInput("0.0.0.0/0").ok)
  const junk = validateBlockInput("<script>alert(1)</script>")
  assert.ok(!junk.ok && /not a valid/.test(junk.error))
  const norm = validateBlockInput("203.0.113.99/24")
  assert.ok(norm.ok && norm.cidr === "203.0.113.0/24")
})
