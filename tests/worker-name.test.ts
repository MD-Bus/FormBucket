import { test } from "node:test"
import assert from "node:assert/strict"
import { workerNameFromHost } from "../app/lib/worker-name.ts"

test("workers.dev hostnames yield the Worker name for `wrangler --name`", () => {
  assert.equal(workerNameFromHost("formbucketlive.freelance-tools-967.workers.dev"), "formbucketlive")
  assert.equal(workerNameFromHost("FormBucket.acme.workers.dev"), "formbucket")
})

test("custom domains, localhost and odd hosts give no name", () => {
  assert.equal(workerNameFromHost("forms.mycompany.com"), null)
  assert.equal(workerNameFromHost("localhost"), null)
  assert.equal(workerNameFromHost("workers.dev"), null)
  assert.equal(workerNameFromHost("evil$name.acme.workers.dev"), null)
  assert.equal(workerNameFromHost("-bad.acme.workers.dev"), null)
})
