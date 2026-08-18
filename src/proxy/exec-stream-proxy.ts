import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { once } from 'node:events'
import type { AddressInfo, Server, Socket } from 'node:net'
import * as net from 'node:net'
import type { CommandSpec } from '../infra/command.js'

export type BridgeFactory = () => ChildProcessWithoutNullStreams

export interface ExecStreamProxyOptions {
  readonly port: number
  readonly host?: '127.0.0.1'
  readonly maxConnections?: number
  readonly stopTimeoutMs?: number
  readonly bridgeFactory: BridgeFactory
  readonly onDiagnostic?: (message: string) => void
}

export interface ProxyAddress {
  readonly host: '127.0.0.1'
  readonly port: number
}

interface Connection {
  readonly client: Socket
  readonly child: ChildProcessWithoutNullStreams
  closed: boolean
}

export function spawnBridge(command: CommandSpec): ChildProcessWithoutNullStreams {
  return spawn(command.executable, [...command.args], {
    cwd: command.cwd,
    env: command.env === undefined ? process.env : { ...command.env },
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

export class ExecStreamProxy {
  readonly #options: Required<
    Pick<ExecStreamProxyOptions, 'host' | 'maxConnections' | 'stopTimeoutMs'>
  > &
    ExecStreamProxyOptions
  readonly #connections = new Set<Connection>()
  #server: Server | null = null
  #stopping = false

  constructor(options: ExecStreamProxyOptions) {
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
      throw new Error(`invalid proxy port: ${String(options.port)}`)
    }
    if (
      options.maxConnections !== undefined &&
      (!Number.isInteger(options.maxConnections) || options.maxConnections < 1)
    ) {
      throw new Error(`invalid proxy connection limit: ${String(options.maxConnections)}`)
    }
    this.#options = {
      ...options,
      host: options.host ?? '127.0.0.1',
      maxConnections: options.maxConnections ?? 32,
      stopTimeoutMs: options.stopTimeoutMs ?? 8_000,
    }
  }

  get activeConnections(): number {
    return this.#connections.size
  }

  async start(): Promise<ProxyAddress> {
    if (this.#server !== null) throw new Error('proxy is already started')
    this.#stopping = false
    const server = net.createServer({ allowHalfOpen: true }, (client) => this.#accept(client))
    this.#server = server
    server.on('error', (error) => this.#options.onDiagnostic?.(`proxy listener: ${error.message}`))
    server.listen({ host: this.#options.host, port: this.#options.port, exclusive: true })
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('proxy has no TCP address')
    return { host: this.#options.host, port: (address as AddressInfo).port }
  }

  async stop(): Promise<void> {
    if (this.#server === null) return
    if (this.#stopping) return
    this.#stopping = true
    const server = this.#server
    this.#server = null

    for (const connection of this.#connections) this.#closeConnection(connection)
    const closed = new Promise<void>((resolve) => server.close(() => resolve()))
    const deadline = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), this.#options.stopTimeoutMs).unref()
    })
    if ((await Promise.race([closed.then(() => 'closed' as const), deadline])) === 'timeout') {
      for (const connection of this.#connections) connection.child.kill('SIGKILL')
      throw new Error('proxy stop timed out while waiting for exec streams')
    }
    this.#stopping = false
  }

  #accept(client: Socket): void {
    if (this.#stopping) {
      client.destroy()
      return
    }
    if (this.#connections.size >= this.#options.maxConnections) {
      this.#options.onDiagnostic?.(
        `proxy connection limit reached: ${String(this.#options.maxConnections)}`,
      )
      const body = 'DSH proxy connection limit reached; retry shortly.\n'
      client.end(
        [
          'HTTP/1.1 503 Service Unavailable',
          'Connection: close',
          'Content-Type: text/plain; charset=utf-8',
          'Retry-After: 1',
          `Content-Length: ${String(Buffer.byteLength(body))}`,
          '',
          body,
        ].join('\r\n'),
      )
      return
    }
    const child = this.#options.bridgeFactory()
    const connection: Connection = { client, child, closed: false }
    this.#connections.add(connection)

    client.on('error', (error) => {
      this.#options.onDiagnostic?.(`browser connection: ${error.message}`)
      child.stdin.destroy()
    })
    client.on('close', () => child.stdin.end())
    child.on('error', (error) => {
      this.#options.onDiagnostic?.(`exec bridge: ${error.message}`)
      client.destroy()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      this.#options.onDiagnostic?.(`exec bridge: ${chunk.toString('utf8').trimEnd()}`)
    })
    child.on('close', () => {
      connection.closed = true
      this.#connections.delete(connection)
      client.end()
    })

    client.pipe(child.stdin)
    child.stdout.pipe(client)
  }

  #closeConnection(connection: Connection): void {
    if (connection.closed) return
    connection.client.destroy()
    connection.child.stdin.end()
  }
}
