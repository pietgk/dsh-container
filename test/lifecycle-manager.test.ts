import * as assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, test } from 'node:test'
import {
  LifecycleManager,
  containerRuntimeState,
  guestNetworkAddresses,
} from '../src/application/lifecycle-manager.js'
import { planInstance } from '../src/application/instance-planner.js'
import { AppleBackend } from '../src/backends/apple/apple-backend.js'
import { resolveManagerPaths } from '../src/config/manager-paths.js'
import { projectRoot } from '../src/constants.js'
import { parseInstanceRecord } from '../src/domain/instance-record.js'
import type { CommandRunner } from '../src/infra/command.js'
import { InstanceStore } from '../src/infra/instance-store.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true })
})

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

test('start rejects uninitialized instances so init gates cannot be bypassed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-container-start-guard-'))
  temporaryRoots.push(root)
  const paths = resolveManagerPaths(root)
  const store = new InstanceStore(paths)
  const record = planInstance({
    name: 'demo',
    workspace: path.join(projectRoot, 'workspaces/demo'),
    id: '0123456789abcdef0123456789abcdef',
    now: new Date('2026-08-17T21:00:00.000Z'),
  })
  await store.write(
    parseInstanceRecord({
      ...record,
      security: {
        ...record.security,
        liveEgressAcknowledgedAt: '2026-08-17T21:00:00.000Z',
        bindRiskAcknowledgedAt: '2026-08-17T21:00:00.000Z',
      },
      lifecycle: { ...record.lifecycle, observed: 'uninitialized' },
    }),
  )

  const runner: CommandRunner = {
    run: async () => {
      throw new Error('start must not invoke container commands for uninitialized instances')
    },
  }
  const manager = new LifecycleManager(paths, new AppleBackend(runner), runner)

  await assert.rejects(
    () => manager.start({ name: 'demo', port: 30081 }),
    /initialization is incomplete/,
  )
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
