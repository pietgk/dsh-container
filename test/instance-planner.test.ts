import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import * as path from 'node:path'
import {
  planInstance,
  resolveManagedWorkspace,
  resolveManagedWorkspaceRoot,
} from '../src/application/instance-planner.js'
import { projectRoot } from '../src/constants.js'

const fixedId = '0123456789abcdef0123456789abcdef'
const fixedTime = new Date('2026-08-17T21:00:00.000Z')

test('planner emits a validated accepted-architecture record', () => {
  const workspace = path.join(projectRoot, 'workspaces/demo')
  const record = planInstance({ name: 'demo', workspace, id: fixedId, now: fixedTime })

  assert.equal(record.schemaVersion, 1)
  assert.equal(record.backend, 'apple')
  assert.equal(record.ui.transport, 'exec-stream')
  assert.equal(record.security.readOnlyRoot, true)
  assert.deepEqual(record.security.publishedPorts, [])
  assert.deepEqual(record.security.publishedSockets, [])
  assert.equal(record.security.liveEgressAcknowledgedAt, null)
  assert.equal(record.security.bindRiskAcknowledgedAt, null)
  assert.equal(record.audit.high, 12)
  assert.equal(record.audit.moderate, 12)
  assert.equal(record.kernel.sha256.length, 64)
})

test('workspace must remain beneath the manager-owned workspace root', () => {
  assert.throws(() => resolveManagedWorkspace('/Users/tester/ws/another-project'))
  assert.throws(() => resolveManagedWorkspace(path.join(projectRoot, 'workspaces')))
})

test('Nix-installed manager can receive its managed workspace root from the environment', () => {
  assert.equal(
    resolveManagedWorkspaceRoot({ DSH_CONTAINER_WORKSPACE_ROOT: '/Users/tester/ws/dsh/workspaces' }),
    '/Users/tester/ws/dsh/workspaces',
  )
})
