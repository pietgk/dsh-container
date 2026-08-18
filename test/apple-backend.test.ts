import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import * as path from 'node:path'
import { AppleBackend, workspaceGitMetadataMounts } from '../src/backends/apple/apple-backend.js'
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
    workspaceGitMetadataMounts(record, {
      pathExists: () => true,
      statType: () => 'directory',
    }).join('\n'),
    `type=bind,source=${record.workspace.hostPath}/.git,target=/workspace/.git,readonly`,
  )
  assert.deepEqual(workspaceGitMetadataMounts(record, { pathExists: () => false }), [])
})

test('git worktrees mount pointer, gitdir, and common dir read-only', () => {
  const hostGit = `${record.workspace.hostPath}/.git`
  const hostGitdir = '/repos/dsh.git/worktrees/demo'
  const hostCommonDir = '/repos/dsh.git'
  const gitMetadataPaths = new Set([
    hostGit,
    hostGitdir,
    `${hostGitdir}/gitdir`,
    `${hostGitdir}/commondir`,
    hostCommonDir,
    `${hostCommonDir}/HEAD`,
    `${hostCommonDir}/objects`,
    `${hostCommonDir}/refs`,
  ])
  const mounts = workspaceGitMetadataMounts(record, {
    pathExists: (candidate) => gitMetadataPaths.has(candidate),
    statType: (candidate) => {
      if (candidate === hostGit || candidate.endsWith('/gitdir') || candidate.endsWith('/commondir')) {
        return 'file'
      }
      if (candidate.endsWith('/HEAD')) return 'file'
      return 'directory'
    },
    readTextFile: (candidate) => {
      if (candidate === hostGit) return `gitdir: ${hostGitdir}\n`
      if (candidate === `${hostGitdir}/gitdir`) return `${hostGit}\n`
      if (candidate === `${hostGitdir}/commondir`) return '../..\n'
      throw new Error(`unexpected read: ${candidate}`)
    },
    realPath: (candidate) => candidate,
  })
  assert.deepEqual(mounts, [
    `type=bind,source=${hostGit},target=/workspace/.git,readonly`,
    `type=bind,source=${hostGitdir},target=${hostGitdir},readonly`,
    `type=bind,source=${hostCommonDir},target=${hostCommonDir},readonly`,
  ])
})

test('git worktree overmount fails closed for malformed pointers', () => {
  const hostGit = `${record.workspace.hostPath}/.git`
  assert.deepEqual(
    workspaceGitMetadataMounts(record, {
      pathExists: () => true,
      statType: () => 'file',
      readTextFile: () => 'not-a-gitdir\n',
      realPath: (candidate) => candidate,
    }),
    [],
  )
  assert.deepEqual(
    workspaceGitMetadataMounts(record, {
      pathExists: (candidate) => candidate !== hostGit,
      statType: (candidate) => (candidate === hostGit ? 'file' : 'directory'),
      readTextFile: () => 'gitdir: /missing/worktree\n',
      realPath: (candidate) => candidate,
    }),
    [],
  )
})

test('git worktree overmount rejects arbitrary host paths', () => {
  const hostGit = `${record.workspace.hostPath}/.git`
  const sensitiveHostPath = '/etc'
  assert.deepEqual(
    workspaceGitMetadataMounts(record, {
      pathExists: (candidate) => [hostGit, sensitiveHostPath].includes(candidate),
      statType: (candidate) => (candidate === hostGit ? 'file' : 'directory'),
      readTextFile: (candidate) => {
        if (candidate === hostGit) return `gitdir: ${sensitiveHostPath}\n`
        throw new Error(`unexpected read: ${candidate}`)
      },
      realPath: (candidate) => candidate,
    }),
    [],
  )
})

test('git worktree overmount rejects traversal escapes without reciprocal validation', () => {
  const hostGit = `${record.workspace.hostPath}/.git`
  const escapedGitdir = '/repos/dsh.git/worktrees/evil'
  assert.deepEqual(
    workspaceGitMetadataMounts(record, {
      pathExists: (candidate) =>
        [hostGit, `${record.workspace.hostPath}/../../etc`, escapedGitdir].includes(candidate),
      statType: (candidate) => (candidate === hostGit ? 'file' : 'directory'),
      readTextFile: (candidate) => {
        if (candidate === hostGit) return 'gitdir: ../../etc\n'
        throw new Error(`unexpected read: ${candidate}`)
      },
      realPath: (candidate) => candidate,
    }),
    [],
  )
})

test('git worktree overmount rejects mismatched reciprocal gitdir pointers', () => {
  const hostGit = `${record.workspace.hostPath}/.git`
  const hostGitdir = '/repos/dsh.git/worktrees/demo'
  const hostCommonDir = '/repos/dsh.git'
  const gitMetadataPaths = new Set([
    hostGit,
    hostGitdir,
    `${hostGitdir}/gitdir`,
    `${hostGitdir}/commondir`,
    hostCommonDir,
    `${hostCommonDir}/HEAD`,
    `${hostCommonDir}/objects`,
    `${hostCommonDir}/refs`,
  ])
  assert.deepEqual(
    workspaceGitMetadataMounts(record, {
      pathExists: (candidate) => gitMetadataPaths.has(candidate),
      statType: (candidate) => {
        if (candidate === hostGit || candidate.endsWith('/gitdir') || candidate.endsWith('/commondir')) {
          return 'file'
        }
        if (candidate.endsWith('/HEAD')) return 'file'
        return 'directory'
      },
      readTextFile: (candidate) => {
        if (candidate === hostGit) return `gitdir: ${hostGitdir}\n`
        if (candidate === `${hostGitdir}/gitdir`) return '/other/workspace/.git\n'
        if (candidate === `${hostGitdir}/commondir`) return '../..\n'
        throw new Error(`unexpected read: ${candidate}`)
      },
      realPath: (candidate) => candidate,
    }),
    [],
  )
})

test('git worktree overmount rejects commondir targets without git metadata structure', () => {
  const hostGit = `${record.workspace.hostPath}/.git`
  const hostGitdir = '/repos/dsh.git/worktrees/demo'
  const hostCommonDir = '/Users/attacker/private'
  const gitMetadataPaths = new Set([
    hostGit,
    hostGitdir,
    `${hostGitdir}/gitdir`,
    `${hostGitdir}/commondir`,
    hostCommonDir,
  ])
  assert.deepEqual(
    workspaceGitMetadataMounts(record, {
      pathExists: (candidate) => gitMetadataPaths.has(candidate),
      statType: (candidate) => {
        if (candidate === hostGit || candidate.endsWith('/gitdir') || candidate.endsWith('/commondir')) {
          return 'file'
        }
        return 'directory'
      },
      readTextFile: (candidate) => {
        if (candidate === hostGit) return `gitdir: ${hostGitdir}\n`
        if (candidate === `${hostGitdir}/gitdir`) return `${hostGit}\n`
        if (candidate === `${hostGitdir}/commondir`) return '../../../../../Users/attacker/private\n'
        throw new Error(`unexpected read: ${candidate}`)
      },
      realPath: (candidate) => candidate,
    }),
    [],
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
