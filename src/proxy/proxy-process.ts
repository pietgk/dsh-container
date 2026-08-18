import { spawn } from 'node:child_process'
import { mkdir, open } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'
import type { ManagerPaths } from '../config/manager-paths.js'
import type { InstanceRecord } from '../domain/instance-record.js'

export interface ProxyProcessIdentity {
  readonly pid: number
  readonly startedAt: string
  readonly port: number
}

export async function startProxyProcess(
  record: InstanceRecord,
  paths: ManagerPaths,
): Promise<ProxyProcessIdentity> {
  if (record.ui.hostPort === null) throw new Error('proxy start requires a reserved host port')
  await mkdir(paths.logs, { recursive: true, mode: 0o700 })
  const log = await open(path.join(paths.logs, `${record.name}-proxy.log`), 'a', 0o600)
  const cliPath = fileURLToPath(new URL('../cli.js', import.meta.url))
  const child = spawn(
    process.execPath,
    [
      cliPath,
      'internal-proxy',
      '--name',
      record.name,
      '--port',
      String(record.ui.hostPort),
      '--home',
      paths.root,
    ],
    {
      detached: true,
      stdio: ['ignore', 'pipe', log.fd],
    },
  )

  try {
    const ready = await waitForReadyLine(child, 8_000)
    if (ready.port !== record.ui.hostPort) throw new Error('proxy reported an unexpected port')
    if (child.pid === undefined) throw new Error('proxy has no process id')
    child.stdout?.destroy()
    child.unref()
    return { pid: child.pid, startedAt: new Date().toISOString(), port: ready.port }
  } catch (error) {
    child.kill('SIGTERM')
    throw error
  } finally {
    await log.close()
  }
}

export async function stopProxyProcess(record: InstanceRecord, paths: ManagerPaths): Promise<void> {
  const pid = record.ui.proxyPid
  if (pid === null) return
  const command = await processCommand(pid)
  if (command === null) return
  if (!proxyCommandMatches(command, record, paths)) {
    throw new Error(
      `refusing to signal PID ${String(pid)} because its command identity does not match`,
    )
  }
  process.kill(pid, 'SIGTERM')
  const deadline = Date.now() + 10_000
  while (await processExists(pid)) {
    if (Date.now() >= deadline) {
      const current = await processCommand(pid)
      if (current === null || !proxyCommandMatches(current, record, paths)) {
        throw new Error(`proxy PID ${String(pid)} changed identity during shutdown`)
      }
      process.kill(pid, 'SIGKILL')
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

export async function proxyProcessMatches(
  record: InstanceRecord,
  paths: ManagerPaths,
): Promise<boolean> {
  if (record.ui.proxyPid === null) return false
  const command = await processCommand(record.ui.proxyPid)
  return command !== null && proxyCommandMatches(command, record, paths)
}

async function waitForReadyLine(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<{ port: number }> {
  if (child.stdout === null) throw new Error('proxy stdout is not available')
  const stdout = child.stdout
  return await new Promise((resolve, reject) => {
    let buffer = ''
    const timeout = setTimeout(() => reject(new Error('proxy readiness timed out')), timeoutMs)
    const finish = (error?: Error, value?: { port: number }) => {
      clearTimeout(timeout)
      child.off('exit', onExit)
      stdout.off('data', onData)
      if (error !== undefined) reject(error)
      else if (value !== undefined) resolve(value)
    }
    const onExit = (code: number | null) =>
      finish(new Error(`proxy exited before ready: ${String(code)}`))
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      try {
        const parsed = JSON.parse(buffer.slice(0, newline)) as { ready?: boolean; port?: number }
        if (parsed.ready !== true || !Number.isInteger(parsed.port)) {
          finish(new Error('proxy returned an invalid readiness record'))
        } else finish(undefined, { port: parsed.port as number })
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }
    child.once('exit', onExit)
    stdout.on('data', onData)
  })
}

async function processCommand(pid: number): Promise<string | null> {
  return await new Promise((resolve, reject) => {
    const child = spawn('ps', ['-p', String(pid), '-o', 'command='], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const output: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
    child.once('error', reject)
    child.once('close', (code) =>
      resolve(code === 0 ? Buffer.concat(output).toString('utf8').trim() : null),
    )
  })
}

function proxyCommandMatches(
  command: string,
  record: InstanceRecord,
  paths: ManagerPaths,
): boolean {
  return (
    hasExactArgument(command, 'internal-proxy') &&
    hasExactOptionValue(command, '--name', record.name) &&
    hasExactOptionValue(command, '--home', paths.root)
  )
}

function hasExactArgument(command: string, value: string): boolean {
  return new RegExp(`(?:^|\\s)${escapeRegex(value)}(?:\\s|$)`).test(command)
}

function hasExactOptionValue(command: string, option: string, value: string): boolean {
  return new RegExp(`(?:^|\\s)${escapeRegex(option)}(?:\\s+|=)${escapeRegex(value)}(?:\\s|$)`).test(
    command,
  )
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function processExists(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
