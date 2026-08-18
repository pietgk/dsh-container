import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import * as path from 'node:path'
import { AppleBackend, workspaceGitMetadataMount } from '../src/backends/apple/apple-backend.js'
import { planInstance } from '../src/application/instance-planner.js'
import { projectRoot } from '../src/constants.js'

const record = planInstance({
  name: 'demo',
  workspace: path.join(projectRoot, 'workspaces/demo'),
  id: '0123456789abcdef0123456789abcdef',
  now: new Date('2026-08-17T21:00:00.000Z'),
})

test('Apple create plan preserves the accepted security invariants', () => {
  const plan = new AppleBackend().planCreate(record)
  const args = plan.createContainer.args

  assert.equal(plan.createContainer.executable, 'container')
  assert.ok(args.includes('--kernel'))
  assert.ok(args.includes(record.kernel.path))
  assert.ok(args.includes('--read-only'))
  assert.deepEqual(args.slice(args.indexOf('--cap-drop'), args.indexOf('--cap-drop') + 2), [
    '--cap-drop',
    'ALL',
  ])
  assert.ok(args.includes('nproc=512:512'))
  assert.ok(args.includes('nofile=1024:1024'))
  assert.ok(!args.includes('--publish'))
  assert.ok(!args.includes('--publish-socket'))
  assert.ok(!args.includes('--ssh'))
  assert.ok(!args.some((value) => value === '0.0.0.0' || value === '::'))
})

test('Apple delete commands contain exact targets and no broad selectors', () => {
  const backend = new AppleBackend()
  const commands = [
    backend.deleteContainerCommand(record),
    backend.deleteNetworkCommand(record),
    ...backend.deleteVolumeCommands(record),
  ]
  for (const command of commands) {
    assert.ok(!command.args.includes('--all'))
    assert.ok(!command.args.some((argument) => argument.includes('*')))
  }
})

test('existing host Git metadata receives an explicit read-only overmount', () => {
  assert.equal(
    workspaceGitMetadataMount(record, () => true),
    `type=bind,source=${record.workspace.hostPath}/.git,target=/workspace/.git,readonly`,
  )
  assert.equal(
    workspaceGitMetadataMount(record, () => false),
    null,
  )
})

test('exec bridge targets the named container and guest loopback', () => {
  const command = new AppleBackend().execBridgeCommand(record)
  assert.deepEqual(command.args.slice(0, 3), ['exec', '--interactive', record.resources.container])
  assert.ok(command.args.at(-1)?.includes("host:'127.0.0.1'"))
  assert.ok(command.args.at(-1)?.includes('port:3080'))
})

test('Landlock probe boots the pinned kernel and requires full enforcement', () => {
  const command = new AppleBackend().landlockProbeCommand(record)
  assert.equal(command.executable, 'container')
  assert.ok(command.args.includes(record.kernel.path))
  assert.ok(command.args.includes(record.image.reference))
  assert.ok(command.args.includes('--read-only'))
  assert.ok(command.args.includes('ALL'))
  assert.match(command.args.at(-1) ?? '', /landlock: fully enforced/)
})
