import { mkdir } from 'node:fs/promises'
import * as net from 'node:net'
import type { AppleBackend } from '../backends/apple/apple-backend.js'
import { verifyImageIdentity, verifyInspectPolicy } from '../backends/apple/inspect-policy.js'
import type { ManagerPaths } from '../config/manager-paths.js'
import { type InstanceRecord, parseInstanceRecord } from '../domain/instance-record.js'
import { type CommandRunner, runOrThrow } from '../infra/command.js'
import { InstanceStore } from '../infra/instance-store.js'
import { verifySha256 } from '../infra/sha256.js'
import { proxyProcessMatches, startProxyProcess, stopProxyProcess } from '../proxy/proxy-process.js'
import { planInstance, resolveManagedWorkspace } from './instance-planner.js'

export interface InitInstanceInput {
  readonly name: string
  readonly workspace: string
  readonly acknowledgeLiveEgress: true
  readonly acknowledgeBindRisk: true
}

export interface StartInstanceInput {
  readonly name: string
  readonly port: number
}

export interface ReconciledStatus {
  readonly record: InstanceRecord
  readonly containerPresent: boolean
  readonly runtimeState: 'running' | 'stopped' | 'missing'
  readonly proxyMatches: boolean
  readonly ready: boolean
  readonly guestAddresses: readonly string[]
  readonly directGuestReachable: boolean | null
  readonly uiUrl: string | null
}

export class LifecycleManager {
  readonly #paths: ManagerPaths
  readonly #store: InstanceStore
  readonly #backend: AppleBackend
  readonly #runner: CommandRunner

  constructor(paths: ManagerPaths, backend: AppleBackend, runner: CommandRunner) {
    this.#paths = paths
    this.#store = new InstanceStore(paths)
    this.#backend = backend
    this.#runner = runner
  }

  async init(input: InitInstanceInput): Promise<InstanceRecord> {
    const existing = await this.#store.read(input.name)
    const now = new Date().toISOString()
    let record: InstanceRecord
    if (existing !== null) {
      if (existing.lifecycle.observed !== 'uninitialized') {
        throw new Error(`instance already exists: ${input.name}`)
      }
      if (existing.workspace.hostPath !== resolveManagedWorkspace(input.workspace)) {
        throw new Error('partial instance workspace does not match retry input')
      }
      record = existing
    } else {
      const draft = planInstance({
        name: input.name,
        workspace: input.workspace,
        now: new Date(now),
      })
      record = parseInstanceRecord({
        ...draft,
        security: {
          ...draft.security,
          liveEgressAcknowledgedAt: now,
          bindRiskAcknowledgedAt: now,
        },
      })
    }

    await mkdir(record.workspace.hostPath, { recursive: true, mode: 0o750 })
    await verifySha256(record.kernel.path, record.kernel.sha256)
    await this.#verifyImage(record)
    await this.#store.write(record)

    const commands = this.#backend.planCreate(record)
    if (!(await this.#exists(this.#backend.inspectNetworkCommand(record)))) {
      await this.#step(record, 'create-network', [record.resources.network], commands.createNetwork)
    }
    const volumeInspections = this.#backend.inspectVolumeCommands(record)
    if (!(await this.#exists(volumeInspections[0]))) {
      await this.#step(
        record,
        'create-state-volume',
        [record.resources.stateVolume],
        commands.createStateVolume,
      )
    }
    if (!(await this.#exists(volumeInspections[1]))) {
      await this.#step(
        record,
        'create-cache-volume',
        [record.resources.cacheVolume],
        commands.createCacheVolume,
      )
    }
    await this.#step(
      record,
      'verify-landlock-enforcement',
      [record.kernel.path, record.image.reference],
      this.#backend.landlockProbeCommand(record),
    )
    await this.#step(
      record,
      'initialize-volume-ownership',
      [record.resources.stateVolume, record.resources.cacheVolume],
      this.#backend.initializeVolumesCommand(record),
    )

    const initialized = parseInstanceRecord({
      ...record,
      updatedAt: new Date().toISOString(),
      lifecycle: { ...record.lifecycle, observed: 'stopped' },
    })
    await this.#store.write(initialized)
    return initialized
  }

  async start(input: StartInstanceInput): Promise<InstanceRecord> {
    const existing = await this.#requireRecord(input.name)
    this.#requireInitCompleted(existing)
    if (
      existing.security.liveEgressAcknowledgedAt === null ||
      existing.security.bindRiskAcknowledgedAt === null
    ) {
      throw new Error('runtime risk acknowledgements are missing')
    }
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
      throw new Error(`invalid host port: ${String(input.port)}`)
    }
    await verifySha256(existing.kernel.path, existing.kernel.sha256)
    await this.#verifyImage(existing)

    const initialInspect = await this.#runner.run(this.#backend.inspectCommand(existing))
    const initialState = containerRuntimeState(initialInspect.exitCode, initialInspect.stdout)
    if (
      existing.ui.hostPort === input.port &&
      initialState === 'running' &&
      (await proxyProcessMatches(existing, this.#paths)) &&
      (await readinessNow(input.port))
    ) {
      await this.#verifyRunningPolicy(existing)
      const running = parseInstanceRecord({
        ...existing,
        updatedAt: new Date().toISOString(),
        lifecycle: { ...existing.lifecycle, observed: 'running', desired: 'running' },
      })
      await this.#store.write(running)
      return running
    }

    if (existing.ui.proxyPid !== null) {
      await stopProxyProcess(existing, this.#paths)
    }
    if (
      existing.ui.hostPort !== null &&
      existing.ui.hostPort !== input.port &&
      initialState !== 'missing'
    ) {
      if (initialState === 'running') {
        await runOrThrow(this.#runner, this.#backend.stopCommand(existing))
      }
      await runOrThrow(this.#runner, this.#backend.deleteContainerCommand(existing))
    }

    let record = parseInstanceRecord({
      ...existing,
      updatedAt: new Date().toISOString(),
      ui: { ...existing.ui, hostPort: input.port, proxyPid: null, proxyStartedAt: null },
      lifecycle: { ...existing.lifecycle, desired: 'running', lastError: null },
    })
    await this.#store.write(record)

    try {
      const proxy = await startProxyProcess(record, this.#paths)
      record = parseInstanceRecord({
        ...record,
        ui: { ...record.ui, proxyPid: proxy.pid, proxyStartedAt: proxy.startedAt },
      })
      await this.#store.write(record)

      const inspect = await this.#runner.run(this.#backend.inspectCommand(record))
      if (inspect.exitCode !== 0) {
        await this.#step(
          record,
          'create-container',
          [record.resources.container],
          this.#backend.planCreate(record).createContainer,
        )
      }
      if (inspect.exitCode !== 0 || !isRunningInspect(inspect.stdout)) {
        await this.#step(
          record,
          'start-container',
          [record.resources.container],
          this.#backend.startCommand(record),
        )
      }
      await waitForReadiness(input.port, 45_000)
      await this.#verifyRunningPolicy(record)

      const running = parseInstanceRecord({
        ...record,
        updatedAt: new Date().toISOString(),
        lifecycle: { ...record.lifecycle, observed: 'running', desired: 'running' },
      })
      await this.#store.write(running)
      return running
    } catch (error) {
      await stopProxyProcess(record, this.#paths).catch(() => undefined)
      const failed = parseInstanceRecord({
        ...record,
        updatedAt: new Date().toISOString(),
        ui: { ...record.ui, proxyPid: null, proxyStartedAt: null },
        lifecycle: {
          ...record.lifecycle,
          observed: 'drifted',
          lastError: error instanceof Error ? error.message : String(error),
        },
      })
      await this.#store.write(failed)
      throw error
    }
  }

  async stop(name: string): Promise<InstanceRecord> {
    const record = await this.#requireRecord(name)
    this.#requireInitCompleted(record)
    const inspect = await this.#runner.run(this.#backend.inspectCommand(record))
    if (inspect.exitCode === 0) {
      const stop = await this.#runner.run(this.#backend.stopCommand(record))
      if (stop.exitCode !== 0 && !stop.stderr.includes('not running')) {
        throw new Error(`container stop failed: ${stop.stderr.trim()}`)
      }
    }
    await stopProxyProcess(record, this.#paths)
    const stopped = parseInstanceRecord({
      ...record,
      updatedAt: new Date().toISOString(),
      ui: { ...record.ui, proxyPid: null, proxyStartedAt: null },
      lifecycle: { ...record.lifecycle, desired: 'stopped', observed: 'stopped', lastError: null },
    })
    await this.#store.write(stopped)
    return stopped
  }

  async status(name: string): Promise<ReconciledStatus> {
    const record = await this.#requireRecord(name)
    const inspect = await this.#runner.run(this.#backend.inspectCommand(record))
    const runtimeState = containerRuntimeState(inspect.exitCode, inspect.stdout)
    const proxyMatches = await proxyProcessMatches(record, this.#paths)
    const ready = record.ui.hostPort === null ? false : await readinessNow(record.ui.hostPort)
    const guestAddresses =
      runtimeState === 'running' ? guestNetworkAddressesFromJson(inspect.stdout) : []
    const directGuestReachable =
      runtimeState !== 'running' || guestAddresses.length === 0
        ? null
        : (
            await Promise.all(
              guestAddresses.map((address) => canConnect(address, record.ui.guestPort)),
            )
          ).some(Boolean)
    return {
      record,
      containerPresent: runtimeState !== 'missing',
      runtimeState,
      proxyMatches,
      ready,
      guestAddresses,
      directGuestReachable,
      uiUrl: record.ui.hostPort === null ? null : `http://127.0.0.1:${String(record.ui.hostPort)}/`,
    }
  }

  async deleteContainer(name: string): Promise<InstanceRecord> {
    const record = await this.#requireRecord(name)
    this.#requireInitCompleted(record)
    const stopped = await this.stop(name)
    const deletion = await this.#runner.run(this.#backend.deleteContainerCommand(stopped))
    if (deletion.exitCode !== 0 && !deletion.stderr.includes('not found')) {
      throw new Error(`container deletion failed: ${deletion.stderr.trim()}`)
    }
    const deleted = parseInstanceRecord({
      ...stopped,
      updatedAt: new Date().toISOString(),
      lifecycle: { ...stopped.lifecycle, observed: 'missing' },
    })
    await this.#store.write(deleted)
    return deleted
  }

  async #verifyImage(record: InstanceRecord): Promise<void> {
    const result = await runOrThrow(this.#runner, {
      executable: 'container',
      args: ['image', 'inspect', record.image.reference],
    })
    const identity = verifyImageIdentity(
      JSON.parse(result.stdout) as unknown,
      record.image.indexDigest,
    )
    if (!identity.accepted) throw new Error(identity.failures.join('; '))
  }

  async #verifyRunningPolicy(record: InstanceRecord): Promise<void> {
    const result = await runOrThrow(this.#runner, this.#backend.inspectCommand(record))
    const inspection = JSON.parse(result.stdout) as unknown
    const policy = verifyInspectPolicy(inspection)
    if (!policy.accepted) throw new Error(`runtime policy failed: ${policy.failures.join('; ')}`)
    const addresses = guestNetworkAddresses(inspection)
    if (addresses.length === 0) {
      throw new Error('runtime policy failed: container has no inspectable guest addresses')
    }
    for (const address of addresses) {
      if (await canConnect(address, record.ui.guestPort)) {
        throw new Error(
          `runtime policy failed: guest address ${address}:${String(record.ui.guestPort)} is directly reachable`,
        )
      }
    }
    const kernel = await runOrThrow(this.#runner, {
      executable: 'container',
      args: ['exec', record.resources.container, 'uname', '-r'],
    })
    if (kernel.stdout.trim() !== record.kernel.runtimeRelease) {
      throw new Error(`runtime kernel is ${kernel.stdout.trim()}`)
    }
  }

  async #step(
    record: InstanceRecord,
    stage: string,
    targets: readonly string[],
    command: Parameters<CommandRunner['run']>[0],
  ): Promise<void> {
    const at = new Date().toISOString()
    await this.#store.appendJournal(record.name, {
      at,
      operation: record.lifecycle.observed === 'uninitialized' ? 'init' : 'start',
      stage,
      status: 'started',
      targets,
    })
    try {
      await runOrThrow(this.#runner, command)
      await this.#store.appendJournal(record.name, {
        at: new Date().toISOString(),
        operation: record.lifecycle.observed === 'uninitialized' ? 'init' : 'start',
        stage,
        status: 'completed',
        targets,
      })
    } catch (error) {
      await this.#store.appendJournal(record.name, {
        at: new Date().toISOString(),
        operation: record.lifecycle.observed === 'uninitialized' ? 'init' : 'start',
        stage,
        status: 'failed',
        targets,
        detail: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async #requireRecord(name: string): Promise<InstanceRecord> {
    const record = await this.#store.read(name)
    if (record === null) throw new Error(`instance not found: ${name}`)
    return record
  }

  #requireInitCompleted(record: InstanceRecord): void {
    if (record.lifecycle.observed === 'uninitialized') {
      throw new Error('instance initialization is incomplete; run init first')
    }
  }

  async #exists(command: Parameters<CommandRunner['run']>[0] | undefined): Promise<boolean> {
    if (command === undefined) return false
    return (await this.#runner.run(command)).exitCode === 0
  }
}

async function waitForReadiness(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await readinessNow(port)) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`DSH readiness timed out at http://127.0.0.1:${String(port)}`)
}

async function readinessNow(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/`, {
      signal: AbortSignal.timeout(1_000),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function canConnect(host: string, port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const finish = (value: boolean) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(1_000, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

export function guestNetworkAddresses(input: unknown): readonly string[] {
  if (!Array.isArray(input)) return []
  const first = input[0]
  if (typeof first !== 'object' || first === null || !('status' in first)) return []
  const status = first.status
  if (typeof status !== 'object' || status === null || !('networks' in status)) return []
  if (!Array.isArray(status.networks)) return []

  const addresses = new Set<string>()
  for (const network of status.networks) {
    if (typeof network !== 'object' || network === null) continue
    for (const key of ['ipv4Address', 'ipv6Address'] as const) {
      if (!(key in network) || typeof network[key] !== 'string') continue
      const address = network[key].split('/', 1)[0]?.trim()
      if (address !== undefined && address.length > 0) addresses.add(address)
    }
  }
  return [...addresses]
}

function guestNetworkAddressesFromJson(stdout: string): readonly string[] {
  try {
    return guestNetworkAddresses(JSON.parse(stdout) as unknown)
  } catch {
    return []
  }
}

function isRunningInspect(stdout: string): boolean {
  return containerRuntimeState(0, stdout) === 'running'
}

export function containerRuntimeState(
  exitCode: number,
  stdout: string,
): 'running' | 'stopped' | 'missing' {
  if (exitCode !== 0) return 'missing'
  try {
    const value = JSON.parse(stdout) as Array<{ status?: { state?: string } }>
    return value[0]?.status?.state === 'running' ? 'running' : 'stopped'
  } catch {
    return 'stopped'
  }
}
