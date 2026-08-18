import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import { redactText, redactValue } from '../src/security/redact.js'

test('redacts bearer, provider, and GitHub token patterns from text', () => {
  const value = 'Bearer abc.def sk-abcdefghijklmnop ghp_12345678901234567890'
  const redacted = redactText(value)
  assert.equal(redacted, 'Bearer [REDACTED] [REDACTED] [REDACTED]')
})

test('redacts nested secret-shaped fields without hiding ordinary identity fields', () => {
  assert.deepEqual(
    redactValue({ apiKey: 'one', nested: { password: 'two', instanceId: 'three' } }),
    { apiKey: '[REDACTED]', nested: { password: '[REDACTED]', instanceId: 'three' } },
  )
})
