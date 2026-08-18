import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { access } from 'node:fs/promises'
import * as path from 'node:path'
import { acceptedDsh, defaultLimits, guestPaths } from '../../constants.js'
import type { InstanceRecord } from '../../domain/instance-record.js'
import { type CommandRunner, type CommandSpec, SpawnCommandRunner } from '../../infra/command.js'
import type { Backend, BackendCommandPlan, BackendProbe } from '../backend.js'

const managerLabel = 'io.dsh-container.managed=true'

export function guestBridgeScript(port: number): string {
  return [
    "import net from 'node:net'",
    `const socket=net.createConnection({host:'127.0.0.1',port:${String(port)}})`,
    "socket.on('error',error=>{console.error(error.message);process.exitCode=1;process.stdin.destroy();socket.destroy()})",
    "socket.on('close',()=>process.stdin.destroy())",
    "process.stdin.on('error',()=>socket.destroy())",
    'process.stdin.pipe(socket)',
    'socket.pipe(process.stdout)',
  ].join(';')
}

function managerInstanceLabel(record: InstanceRecord): string {
  return `io.dsh-container.instance=${record.id}`
}

export class AppleBackend implements Backend {
  readonly #runner: CommandRunner

  constructor(runner: CommandRunner = new SpawnCommandRunner()) {
    this.#runner = runner
  }

  async probeHost(): Promise<BackendProbe> {
    try {
      const version = await this.#runner.run({ executable: 'container', args: ['--version'] })
      if (version.exitCode !== 0) {
        return {
          backend: 'apple',
          available: false,
          version: null,
          serviceRunning: false,
          detail: version.stderr.trim() || 'container --version failed',
        }
      }
      const list = await this.#runner.run({
        executable: 'container',
        args: ['list', '--format', 'json'],
      })
      return {
        backend: 'apple',
        available: true,
        version: version.stdout.trim(),
        serviceRunning: list.exitCode === 0,
        detail:
          list.exitCode === 0 ? 'Apple Container API service is reachable' : list.stderr.trim(),
      }
    } catch (error) {
      return {
        backend: 'apple',
        available: false,
        version: null,
        serviceRunning: false,
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async verifyKernelPresent(record: InstanceRecord): Promise<void> {
    await access(record.kernel.path)
  }

  planCreate(record: InstanceRecord): BackendCommandPlan {
    const label = managerInstanceLabel(record)
    return {
      createNetwork: {
        executable: 'container',
        args: [
          'network',
          'create',
          '--label',
          managerLabel,
          '--label',
          label,
          record.resources.network,
        ],
      },
      createStateVolume: {
        executable: 'container',
        args: [
          'volume',
          'create',
          '--label',
          managerLabel,
          '--label',
          label,
          '-s',
          defaultLimits.stateVolumeSize,
          record.resources.stateVolume,
        ],
      },
      createCacheVolume: {
        executable: 'container',
        args: [
          'volume',
          'create',
          '--label',
          managerLabel,
          '--label',
          label,
          '-s',
          defaultLimits.cacheVolumeSize,
          record.resources.cacheVolume,
        ],
      },
      createContainer: this.#createContainerCommand(record),
    }
  }

  initializeVolumesCommand(record: InstanceRecord): CommandSpec {
    const initializer = [
      "import {mkdir,chown} from 'node:fs/promises'",
      "const paths=['/state','/state/launch','/state/home','/state/dsh','/cache']",
      'for(const path of paths){await mkdir(path,{recursive:true})}',
      'for(const path of paths.toReversed()){await chown(path,1000,1000)}',
    ].join(';')
    return {
      executable: 'container',
      args: [
        'run',
        '--rm',
        '--name',
        `${record.resources.container}-volume-init`,
        '--kernel',
        record.kernel.path,
        '--uid',
        '0',
        '--gid',
        '0',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--cap-add',
        'CAP_CHOWN',
        '--cap-add',
        'CAP_DAC_OVERRIDE',
        '--mount',
        `type=volume,source=${record.resources.stateVolume},target=${guestPaths.state}`,
        '--mount',
        `type=volume,source=${record.resources.cacheVolume},target=${guestPaths.cache}`,
        '--network',
        record.resources.network,
        '--entrypoint',
        'node',
        record.image.reference,
        '--input-type=module',
        '-e',
        initializer,
      ],
    }
  }

  landlockProbeCommand(record: InstanceRecord): CommandSpec {
    const probe = [
      "import {spawnSync} from 'node:child_process'",
      `const result=spawnSync(${JSON.stringify(acceptedDsh.landlockLauncher)},['--probe'],{encoding:'utf8'})`,
      'if(result.stdout)process.stdout.write(result.stdout)',
      'if(result.stderr)process.stderr.write(result.stderr)',
      "if(result.status!==0||result.stdout.trim()!=='landlock: fully enforced')process.exit(1)",
    ].join(';')
    return {
      executable: 'container',
      args: [
        'run',
        '--rm',
        '--name',
        `${record.resources.container}-landlock-probe`,
        '--kernel',
        record.kernel.path,
        '--uid',
        '1000',
        '--gid',
        '1000',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--network',
        record.resources.network,
        '--entrypoint',
        'node',
        record.image.reference,
        '--input-type=module',
        '-e',
        probe,
      ],
    }
  }

  startCommand(record: InstanceRecord): CommandSpec {
    return { executable: 'container', args: ['start', record.resources.container] }
  }

  stopCommand(record: InstanceRecord): CommandSpec {
    return {
      executable: 'container',
      args: ['stop', '--signal', 'TERM', '--time', '10', record.resources.container],
    }
  }

  inspectCommand(record: InstanceRecord): CommandSpec {
    return { executable: 'container', args: ['inspect', record.resources.container] }
  }

  logsCommand(record: InstanceRecord, follow: boolean, lines?: number): CommandSpec {
    const args = ['logs']
    if (follow) args.push('--follow')
    if (lines !== undefined) args.push('-n', String(lines))
    args.push(record.resources.container)
    return { executable: 'container', args }
  }

  execBridgeCommand(record: InstanceRecord): CommandSpec {
    return {
      executable: 'container',
      args: [
        'exec',
        '--interactive',
        record.resources.container,
        'node',
        '--input-type=module',
        '-e',
        guestBridgeScript(record.ui.guestPort),
      ],
    }
  }

  deleteContainerCommand(record: InstanceRecord): CommandSpec {
    return { executable: 'container', args: ['delete', record.resources.container] }
  }

  deleteNetworkCommand(record: InstanceRecord): CommandSpec {
    return { executable: 'container', args: ['network', 'delete', record.resources.network] }
  }

  deleteVolumeCommands(record: InstanceRecord): readonly CommandSpec[] {
    return [record.resources.stateVolume, record.resources.cacheVolume].map((volume) => ({
      executable: 'container',
      args: ['volume', 'delete', volume],
    }))
  }

  inspectNetworkCommand(record: InstanceRecord): CommandSpec {
    return { executable: 'container', args: ['network', 'inspect', record.resources.network] }
  }

  inspectVolumeCommands(record: InstanceRecord): readonly CommandSpec[] {
    return [record.resources.stateVolume, record.resources.cacheVolume].map((volume) => ({
      executable: 'container',
      args: ['volume', 'inspect', volume],
    }))
  }

  #createContainerCommand(record: InstanceRecord): CommandSpec {
    const environment = [
      'HOME=/state/home',
      `DSH_HOME=${guestPaths.dshHome}`,
      'DSH_TELEMETRY_DISABLED=1',
      'XDG_CACHE_HOME=/cache/xdg',
      'XDG_CONFIG_HOME=/state/xdg/config',
      'XDG_DATA_HOME=/state/xdg/data',
      'XDG_STATE_HOME=/state/xdg/state',
      'COREPACK_HOME=/cache/corepack',
      'PNPM_HOME=/cache/pnpm',
      'npm_config_cache=/cache/npm',
      'npm_config_store_dir=/cache/pnpm-store',
      'TMPDIR=/tmp',
    ]
    if (record.ui.hostPort !== null) {
      environment.push(`DSH_TRUSTED_HOST=127.0.0.1:${String(record.ui.hostPort)}`)
    }
    const args = [
      'create',
      '--name',
      record.resources.container,
      '--label',
      managerLabel,
      '--label',
      managerInstanceLabel(record),
      '--kernel',
      record.kernel.path,
      '--uid',
      '1000',
      '--gid',
      '1000',
      '--workdir',
      guestPaths.workdir,
      '--read-only',
      '--cap-drop',
      'ALL',
      '--cpus',
      String(record.limits.cpus),
      '--memory',
      record.limits.memory,
      '--ulimit',
      `nproc=${String(record.limits.nproc)}:${String(record.limits.nproc)}`,
      '--ulimit',
      `nofile=${String(record.limits.nofile)}:${String(record.limits.nofile)}`,
      '--tmpfs',
      guestPaths.temporary,
      '--mount',
      `type=bind,source=${record.workspace.hostPath},target=${guestPaths.workspace}`,
    ]
    for (const gitMount of workspaceGitMetadataMounts(record)) {
      args.push('--mount', gitMount)
    }
    args.push(
      '--mount',
      `type=volume,source=${record.resources.stateVolume},target=${guestPaths.state}`,
      '--mount',
      `type=volume,source=${record.resources.cacheVolume},target=${guestPaths.cache}`,
      '--network',
      record.resources.network,
      '--init',
    )
    for (const entry of environment) args.push('--env', entry)
    args.push(record.image.reference)
    return { executable: 'container', args }
  }
}

interface GitMetadataDeps {
  readonly pathExists?: (candidate: string) => boolean
  readonly lstatType?: (candidate: string) => 'file' | 'directory' | 'symlink'
  readonly realPath?: (candidate: string) => string
}

function canonicalPath(candidate: string, realPath: (resolved: string) => string): string | null {
  try {
    return realPath(candidate)
  } catch {
    return null
  }
}

function isPathContainedIn(candidate: string, root: string): boolean {
  const normalizedCandidate = path.normalize(candidate)
  const normalizedRoot = path.normalize(root)
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
  )
}

export function workspaceGitMetadataMounts(
  record: InstanceRecord,
  deps: GitMetadataDeps = {},
): readonly string[] {
  const pathExists = deps.pathExists ?? existsSync
  const lstatType =
    deps.lstatType ??
    ((candidate: string) => {
      const stats = lstatSync(candidate)
      if (stats.isSymbolicLink()) return 'symlink'
      if (stats.isDirectory()) return 'directory'
      return 'file'
    })
  const realPath = deps.realPath ?? ((candidate: string) => realpathSync(candidate))
  const hostGit = path.join(record.workspace.hostPath, '.git')
  if (!pathExists(hostGit)) return []

  const canonicalWorkspace = canonicalPath(record.workspace.hostPath, realPath)
  if (canonicalWorkspace === null) {
    throw new Error(`workspace path cannot be resolved safely: ${record.workspace.hostPath}`)
  }

  const gitEntryType = lstatType(hostGit)
  if (gitEntryType !== 'directory') {
    throw new Error(
      `workspace .git must be a real directory contained in the workspace; ${gitEntryType} entries and linked worktrees are unsupported in version 1`,
    )
  }

  const canonicalHostGit = canonicalPath(hostGit, realPath)
  if (canonicalHostGit === null || !isPathContainedIn(canonicalHostGit, canonicalWorkspace)) {
    throw new Error('workspace .git resolves outside the workspace and cannot be mounted safely')
  }

  return [`type=bind,source=${hostGit},target=${guestPaths.workspace}/.git,readonly`]
}
