#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { Command } from 'commander'
import { AppleBackend } from './backends/apple/apple-backend.js'
import { runDoctor } from './application/doctor.js'
import { planInstance, resolveManagedWorkspaceRoot } from './application/instance-planner.js'
import { LifecycleManager } from './application/lifecycle-manager.js'
import { resolveManagerPaths } from './config/manager-paths.js'
import { managerVersion } from './constants.js'
import { InstanceStore } from './infra/instance-store.js'
import { type CommandSpec, formatCommand, SpawnCommandRunner } from './infra/command.js'
import { ExecStreamProxy, spawnBridge } from './proxy/exec-stream-proxy.js'
import { redactText, redactValue } from './security/redact.js'

const program = new Command()
  .name('dsh-container')
  .description('Manage isolated DSH evaluation instances on Apple Container')
  .version(managerVersion)
  .showSuggestionAfterError()
  .showHelpAfterError()

program
  .command('doctor')
  .description('Verify the non-mutating Apple backend and pinned-kernel prerequisites')
  .option('--json', 'print machine-readable JSON')
  .action(async (options: { json?: boolean }) => {
    const report = await runDoctor()
    if (options.json === true) printJson(report)
    else {
      for (const check of report.checks) {
        process.stdout.write(
          `${check.status === 'pass' ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}\n`,
        )
      }
    }
    if (!report.accepted) process.exitCode = 1
  })

program
  .command('plan')
  .description('Print the exact non-mutating Phase 2 resource and command plan')
  .requiredOption('--name <name>', 'logical instance name')
  .requiredOption('--workspace <path>', 'managed bind workspace below ./workspaces')
  .option('--json', 'print machine-readable JSON')
  .action((options: { name: string; workspace: string; json?: boolean }) => {
    const record = planInstance({ name: options.name, workspace: options.workspace })
    const commands = new AppleBackend().planCreate(record)
    const result = {
      mutatesHost: false,
      requiredAcknowledgements: ['live unrestricted guest egress', 'bind-workspace data risk'],
      record,
      exactTargets: {
        container: record.resources.container,
        network: record.resources.network,
        stateVolume: record.resources.stateVolume,
        cacheVolume: record.resources.cacheVolume,
        workspace: record.workspace.hostPath,
        kernel: record.kernel.path,
      },
      commands: Object.fromEntries(
        Object.entries(commands).map(([name, command]) => [name, formatCommand(command)]),
      ),
    }
    if (options.json === true) printJson(result)
    else {
      process.stdout.write('DRY RUN - no resources were created\n')
      process.stdout.write(`Instance: ${record.name} (${record.id})\n`)
      process.stdout.write(
        `Required acknowledgements: ${result.requiredAcknowledgements.join('; ')}\n`,
      )
      for (const [kind, target] of Object.entries(result.exactTargets)) {
        process.stdout.write(`Target ${kind}: ${target}\n`)
      }
      for (const [kind, command] of Object.entries(result.commands)) {
        process.stdout.write(`Command ${kind}: ${command}\n`)
      }
    }
  })

program
  .command('init')
  .description('Create exact managed workspace, network, and persistent volumes')
  .requiredOption('--name <name>', 'logical instance name')
  .option('--workspace <path>', 'managed bind workspace; defaults to ./workspaces/<name>')
  .option('--ack-live-egress', 'acknowledge unrestricted guest DNS and IP egress')
  .option('--ack-bind-risk', 'acknowledge that guest code can modify the exact bind workspace')
  .option('--home <path>', 'override manager state directory')
  .action(
    async (options: {
      name: string
      workspace?: string
      ackLiveEgress?: boolean
      ackBindRisk?: boolean
      home?: string
    }) => {
      if (options.ackLiveEgress !== true || options.ackBindRisk !== true) {
        throw new Error('init requires both --ack-live-egress and --ack-bind-risk')
      }
      const paths = resolveManagerPaths(options.home)
      const runner = new SpawnCommandRunner()
      const record = await new LifecycleManager(paths, new AppleBackend(runner), runner).init({
        name: options.name,
        workspace: options.workspace ?? `${resolveManagedWorkspaceRoot()}/${options.name}`,
        acknowledgeLiveEgress: true,
        acknowledgeBindRisk: true,
      })
      printJson({ initialized: true, name: record.name, resources: record.resources })
    },
  )

program
  .command('start')
  .description('Start a managed DSH container and its loopback exec-stream proxy')
  .requiredOption('--name <name>', 'logical instance name')
  .option('--port <port>', 'Mac loopback port', '30081')
  .option('--home <path>', 'override manager state directory')
  .action(async (options: { name: string; port: string; home?: string }) => {
    const paths = resolveManagerPaths(options.home)
    const runner = new SpawnCommandRunner()
    const record = await new LifecycleManager(paths, new AppleBackend(runner), runner).start({
      name: options.name,
      port: Number.parseInt(options.port, 10),
    })
    printJson({
      ready: true,
      name: record.name,
      url: `http://127.0.0.1:${String(record.ui.hostPort)}/`,
      proxyPid: record.ui.proxyPid,
    })
  })

program
  .command('stop')
  .description('Gracefully stop the named container and owned proxy')
  .requiredOption('--name <name>', 'logical instance name')
  .option('--home <path>', 'override manager state directory')
  .action(async (options: { name: string; home?: string }) => {
    const paths = resolveManagerPaths(options.home)
    const runner = new SpawnCommandRunner()
    const record = await new LifecycleManager(paths, new AppleBackend(runner), runner).stop(
      options.name,
    )
    printJson({ stopped: true, name: record.name })
  })

program
  .command('status')
  .description('Reconcile locally recorded metadata with the Apple runtime and proxy')
  .requiredOption('--name <name>', 'logical instance name')
  .option('--home <path>', 'override manager state directory')
  .option('--json', 'print machine-readable JSON')
  .action(async (options: { name: string; home?: string; json?: boolean }) => {
    const paths = resolveManagerPaths(options.home)
    const runner = new SpawnCommandRunner()
    const status = await new LifecycleManager(paths, new AppleBackend(runner), runner).status(
      options.name,
    )
    const record = status.record
    if (options.json === true) printJson(status)
    else {
      process.stdout.write(`${record.name}: ${record.lifecycle.observed}\n`)
      process.stdout.write(`DSH ${record.source.version} ${record.source.commitSha}\n`)
      process.stdout.write(`Workspace ${record.workspace.hostPath}\n`)
      process.stdout.write(`Transport ${record.ui.transport}\n`)
      process.stdout.write(`Container ${status.runtimeState}\n`)
      process.stdout.write(`Proxy ${status.proxyMatches ? 'owned' : 'absent'}\n`)
      process.stdout.write(`Readiness ${status.ready ? 'ready' : 'not ready'}\n`)
      process.stdout.write(`Web UI ${status.uiUrl ?? 'unassigned'}\n`)
      process.stdout.write(
        `Guest addresses ${status.guestAddresses.length === 0 ? 'none' : status.guestAddresses.join(', ')}\n`,
      )
      process.stdout.write(
        `Direct guest Web ${
          status.directGuestReachable === null
            ? 'not testable'
            : status.directGuestReachable
              ? 'REACHABLE'
              : 'blocked'
        }\n`,
      )
    }
  })

program
  .command('logs')
  .description('Print a bounded recent view of DSH container logs')
  .requiredOption('--name <name>', 'logical instance name')
  .option('--lines <lines>', 'number of recent lines', '100')
  .option('--follow', 'continue streaming new log lines')
  .option('--home <path>', 'override manager state directory')
  .action(async (options: { name: string; lines: string; follow?: boolean; home?: string }) => {
    const store = new InstanceStore(resolveManagerPaths(options.home))
    const record = await store.read(options.name)
    if (record === null) throw new Error(`instance not found: ${options.name}`)
    const lines = Number.parseInt(options.lines, 10)
    if (!Number.isInteger(lines) || lines < 1 || lines > 10_000)
      throw new Error('invalid log line count')
    const command = new AppleBackend().logsCommand(record, options.follow === true, lines)
    if (options.follow === true) {
      await streamRedactedCommand(command)
      return
    }
    const result = await new SpawnCommandRunner().run(command)
    process.stdout.write(redactText(result.stdout))
    if (result.exitCode !== 0) throw new Error(result.stderr.trim())
  })

program
  .command('delete')
  .description(
    'Delete only the disposable container; preserve state, cache, workspace, and network',
  )
  .requiredOption('--name <name>', 'logical instance name')
  .option('--home <path>', 'override manager state directory')
  .action(async (options: { name: string; home?: string }) => {
    const paths = resolveManagerPaths(options.home)
    const runner = new SpawnCommandRunner()
    const record = await new LifecycleManager(
      paths,
      new AppleBackend(runner),
      runner,
    ).deleteContainer(options.name)
    printJson({
      deletedContainer: record.resources.container,
      preserved: [
        record.resources.stateVolume,
        record.resources.cacheVolume,
        record.resources.network,
        record.workspace.hostPath,
      ],
    })
  })

program
  .command('internal-proxy', { hidden: true })
  .description('Run the manager-owned exec-stream proxy for a recorded instance')
  .requiredOption('--name <name>')
  .requiredOption('--port <port>')
  .option('--home <path>')
  .action(async (options: { name: string; port: string; home?: string }) => {
    const store = new InstanceStore(resolveManagerPaths(options.home))
    const record = await store.read(options.name)
    if (record === null) throw new Error(`instance not found: ${options.name}`)
    const port = Number.parseInt(options.port, 10)
    const command = new AppleBackend().execBridgeCommand(record)
    const proxy = new ExecStreamProxy({
      port,
      bridgeFactory: () => spawnBridge(command),
      onDiagnostic: (message) => process.stderr.write(`${redactText(message)}\n`),
    })
    const address = await proxy.start()
    process.stdout.write(
      `${JSON.stringify({ ready: true, ...address, instance: record.name, transport: 'exec-stream' })}\n`,
    )
    await waitForStopSignal()
    await proxy.stop()
  })

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(redactValue(value), null, 2)}\n`)
}

async function waitForStopSignal(): Promise<void> {
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve)
    process.once('SIGTERM', resolve)
  })
}

async function streamRedactedCommand(command: CommandSpec): Promise<void> {
  const child = spawn(command.executable, [...command.args], {
    cwd: command.cwd,
    env: command.env === undefined ? process.env : { ...process.env, ...command.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let interrupted = false

  const writeLines = (chunk: Buffer, buffer: string, destination: NodeJS.WriteStream): string => {
    const combined = buffer + chunk.toString('utf8')
    const lines = combined.split('\n')
    const remainder = lines.pop() ?? ''
    for (const line of lines) destination.write(`${redactText(line)}\n`)
    return remainder
  }
  child.stdout.on('data', (chunk: Buffer) => {
    stdout = writeLines(chunk, stdout, process.stdout)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = writeLines(chunk, stderr, process.stderr)
  })

  const forwardSignal = () => {
    interrupted = true
    child.kill('SIGTERM')
  }
  process.once('SIGINT', forwardSignal)
  process.once('SIGTERM', forwardSignal)
  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => resolve(code ?? 1))
    })
    if (stdout.length > 0) process.stdout.write(redactText(stdout))
    if (stderr.length > 0) process.stderr.write(redactText(stderr))
    if (!interrupted && exitCode !== 0) {
      throw new Error(`log stream exited ${String(exitCode)}`)
    }
  } finally {
    process.off('SIGINT', forwardSignal)
    process.off('SIGTERM', forwardSignal)
  }
}

try {
  await program.parseAsync(process.argv)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`dsh-container: ${redactText(message)}\n`)
  process.exitCode = 1
}
