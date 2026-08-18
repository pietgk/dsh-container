import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  containerRuntimeState,
  guestNetworkAddresses,
} from '../src/application/lifecycle-manager.js'

test('guest network addresses extracts IPv4 and IPv6 without CIDR suffixes', () => {
  assert.deepEqual(
    guestNetworkAddresses([
      {
        status: {
          networks: [
            {
              ipv4Address: '192.168.66.5/24',
              ipv6Address: 'fd12:b469:1234:85db:f052:4ff:fe9a:59b2/64',
            },
          ],
        },
      },
    ]),
    ['192.168.66.5', 'fd12:b469:1234:85db:f052:4ff:fe9a:59b2'],
  )
})

test('guest network addresses fails closed on unknown inspect shapes', () => {
  assert.deepEqual(guestNetworkAddresses({ status: { networks: [] } }), [])
  assert.deepEqual(guestNetworkAddresses([{ status: { networks: [{ ipv4Address: null }] } }]), [])
})

test('container runtime state reconciles running, stopped, and missing containers', () => {
  assert.equal(containerRuntimeState(1, ''), 'missing')
  assert.equal(
    containerRuntimeState(0, JSON.stringify([{ status: { state: 'running' } }])),
    'running',
  )
  assert.equal(
    containerRuntimeState(0, JSON.stringify([{ status: { state: 'stopped' } }])),
    'stopped',
  )
})
