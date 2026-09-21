import { test } from "node:test"
import assert from "node:assert/strict"
import { deviceFromUserAgent } from "../app/lib/device.ts"

test("view beacons ignore scripts and crawlers (device class 'bot')", () => {
  for (const ua of ["curl/8.4.0", "python-requests/2.31", "node-fetch/1.0", "Wget/1.21", "Googlebot/2.1", "axios/1.6", "Go-http-client/1.1 httpclient"]) {
    assert.equal(deviceFromUserAgent(ua), "bot", ua)
  }
  assert.equal(deviceFromUserAgent(null), "unknown")
})

test("real browsers are not mistaken for bots", () => {
  const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"
  assert.equal(deviceFromUserAgent(chrome), "desktop")
  assert.equal(deviceFromUserAgent(iphone), "mobile")
})
