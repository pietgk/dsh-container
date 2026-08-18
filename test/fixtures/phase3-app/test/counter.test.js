import assert from 'node:assert/strict'
import test from 'node:test'
import { increment } from '../src/counter.js'

test('increment adds one', () => {
  assert.equal(increment(4), 5)
})

test('increment rejects non-integers', () => {
  assert.throws(() => increment(1.5), /integer/)
})
