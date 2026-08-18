import { spawn } from 'node:child_process'

export interface CommandSpec {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly stdin?: string
}

export interface CommandResult {
  readonly command: CommandSpec
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly dryRun: boolean
}

export interface CommandRunner {
  run(command: CommandSpec): Promise<CommandResult>
}

export interface SpawnCommandRunnerOptions {
  readonly dryRun?: boolean
  readonly onCommand?: (display: string) => void
}

function quoteArgument(value: string): string {
  if (/^[A-Za-z0-9_./:@=,+-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function formatCommand(command: CommandSpec): string {
  return [command.executable, ...command.args].map(quoteArgument).join(' ')
}

export class SpawnCommandRunner implements CommandRunner {
  readonly #dryRun: boolean
  readonly #onCommand: ((display: string) => void) | undefined

  constructor(options: SpawnCommandRunnerOptions = {}) {
    this.#dryRun = options.dryRun ?? false
    this.#onCommand = options.onCommand
  }

  async run(command: CommandSpec): Promise<CommandResult> {
    this.#onCommand?.(formatCommand(command))
    if (this.#dryRun) {
      return { command, exitCode: 0, stdout: '', stderr: '', dryRun: true }
    }

    return await new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(command.executable, [...command.args], {
        cwd: command.cwd,
        env: command.env === undefined ? process.env : { ...command.env },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.once('error', reject)
      child.once('close', (exitCode) => {
        resolve({
          command,
          exitCode: exitCode ?? 1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          dryRun: false,
        })
      })

      if (command.stdin === undefined) child.stdin.end()
      else child.stdin.end(command.stdin)
    })
  }
}

export async function runOrThrow(
  runner: CommandRunner,
  command: CommandSpec,
): Promise<CommandResult> {
  const result = await runner.run(command)
  if (result.exitCode !== 0) {
    throw new Error(
      `${formatCommand(command)} exited ${String(result.exitCode)}: ${result.stderr.trim()}`,
    )
  }
  return result
}
