import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deriveResourceNames,
  parseInstanceId,
  parseInstanceName,
} from '../src/domain/resource-names.js'

test('instance names accept the narrow portable grammar', () => {
  assert.equal(parseInstanceName('demo-1'), 'demo-1')
  assert.equal(parseInstanceName('x'), 'x')
})

test('instance names reject traversal, uppercase, and trailing separators', () => {
  for (const value of ['../demo', 'Demo', 'demo-', 'demo_name', '', 'a'.repeat(33)]) {
    assert.throws(() => parseInstanceName(value))
  }
})

test('resource names are deterministic and collision-resistant within a logical name', () => {
  const id = parseInstanceId('0123456789abcdef0123456789abcdef')
  assert.deepEqual(deriveResourceNames('demo', id), {
    container: 'dshc-demo-0123456789-ctr',
    network: 'dshc-demo-0123456789-net',
    stateVolume: 'dshc-demo-0123456789-state',
    cacheVolume: 'dshc-demo-0123456789-cache',
    proxyLabel: 'dshc-demo-0123456789-proxy',
  })
})
