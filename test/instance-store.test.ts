import * as assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, test } from 'node:test'
import { planInstance } from '../src/application/instance-planner.js'
import {
  resolveManagerPaths,
  instanceJournalPath,
  instanceRecordPath,
} from '../src/config/manager-paths.js'
import { projectRoot } from '../src/constants.js'
import { InstanceStore } from '../src/infra/instance-store.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true })
})

test('instance store atomically round-trips validated metadata with private permissions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-container-store-'))
  temporaryRoots.push(root)
  const paths = resolveManagerPaths(root)
  const store = new InstanceStore(paths)
  const record = planInstance({
    name: 'demo',
    workspace: path.join(projectRoot, 'workspaces/demo'),
    id: '0123456789abcdef0123456789abcdef',
    now: new Date('2026-08-17T21:00:00.000Z'),
  })

  await store.write(record)
  assert.deepEqual(await store.read('demo'), record)
  assert.equal((await stat(instanceRecordPath(paths, 'demo'))).mode & 0o777, 0o600)
})

test('failure journal redacts secret values before persistence', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-container-journal-'))
  temporaryRoots.push(root)
  const paths = resolveManagerPaths(root)
  const store = new InstanceStore(paths)

  await store.appendJournal('demo', {
    at: '2026-08-17T21:00:00.000Z',
    operation: 'init',
    stage: 'audit',
    status: 'failed',
    targets: ['dshc-demo-0123456789-ctr'],
    detail: { apiKey: 'sk-abcdefghijklmnop', reason: 'provider rejected token' },
  })
  const contents = await readFile(instanceJournalPath(paths, 'demo'), 'utf8')
  assert.ok(contents.includes('[REDACTED]'))
  assert.ok(!contents.includes('sk-abcdefghijklmnop'))
  assert.equal((await stat(instanceJournalPath(paths, 'demo'))).mode & 0o777, 0o600)
})
