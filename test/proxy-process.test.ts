import * as assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, test } from 'node:test'
import { planInstance } from '../src/application/instance-planner.js'
import { resolveManagerPaths } from '../src/config/manager-paths.js'
import { projectRoot } from '../src/constants.js'
import { proxyProcessMatches, stopProxyProcess } from '../src/proxy/proxy-process.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true })
})

test('proxy identity matching rejects prefix-collision names', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-container-proxy-prefix-'))
  temporaryRoots.push(root)
  const paths = resolveManagerPaths(root)
  const child = spawnProxyProcess('demo-extra', paths.root)

  try {
    const record = {
      ...planInstance({
        name: 'demo',
        workspace: path.join(projectRoot, 'workspaces/demo'),
        id: '0123456789abcdef0123456789abcdef',
        now: new Date('2026-08-18T09:30:00.000Z'),
      }),
      ui: {
        guestPort: 3080,
        hostPort: 30080,
        transport: 'exec-stream' as const,
        proxyPid: child.pid ?? null,
        proxyStartedAt: '2026-08-18T09:30:00.000Z',
      },
    }

    assert.equal(await proxyProcessMatches(record, paths), false)
    await assert.rejects(
      () => stopProxyProcess(record, paths),
      /command identity does not match/,
    )
    assert.equal(child.killed, false)
  } finally {
    child.kill('SIGKILL')
  }
})

test('proxy identity matching accepts exact instance names', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-container-proxy-exact-'))
  temporaryRoots.push(root)
  const paths = resolveManagerPaths(root)
  const child = spawnProxyProcess('demo', paths.root)

  try {
    const record = {
      ...planInstance({
        name: 'demo',
        workspace: path.join(projectRoot, 'workspaces/demo'),
        id: 'fedcba9876543210fedcba9876543210',
        now: new Date('2026-08-18T09:31:00.000Z'),
      }),
      ui: {
        guestPort: 3080,
        hostPort: 30080,
        transport: 'exec-stream' as const,
        proxyPid: child.pid ?? null,
        proxyStartedAt: '2026-08-18T09:31:00.000Z',
      },
    }

    assert.equal(await proxyProcessMatches(record, paths), true)
    await stopProxyProcess(record, paths)
  } finally {
    child.kill('SIGKILL')
  }
})

function spawnProxyProcess(name: string, home: string) {
  return spawn(
    process.execPath,
    [
      '-e',
      "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)",
      'internal-proxy',
      '--name',
      name,
      '--home',
      home,
    ],
    {
      stdio: 'ignore',
    },
  )
}
