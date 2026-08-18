import { chmod, lstat, unlink } from 'node:fs/promises'
import net from 'node:net'
import { spawn } from 'node:child_process'

const socketPath = process.env.DSH_BRIDGE_SOCKET ?? '/tmp/dsh-web.sock'
const webPort = Number.parseInt(process.env.DSH_WEB_PORT ?? '3080', 10)
const trustedHost = process.env.DSH_TRUSTED_HOST ?? `127.0.0.1:${String(webPort)}`

if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535) {
  throw new Error(`invalid DSH_WEB_PORT: ${String(process.env.DSH_WEB_PORT)}`)
}

try {
  const existing = await lstat(socketPath)
  if (!existing.isSocket()) throw new Error(`refusing to replace non-socket path: ${socketPath}`)
  await unlink(socketPath)
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

process.umask(0o077)

const bridge = net.createServer({ allowHalfOpen: true }, (downstream) => {
  const upstream = net.createConnection({ host: '127.0.0.1', port: webPort, allowHalfOpen: true })
  const closeBoth = (error) => {
    if (error !== undefined) process.stderr.write(`dsh bridge: ${error.message}\n`)
    downstream.destroy()
    upstream.destroy()
  }
  downstream.on('error', closeBoth)
  upstream.on('error', closeBoth)
  downstream.pipe(upstream)
  upstream.pipe(downstream)
})

await new Promise((resolve, reject) => {
  bridge.once('error', reject)
  bridge.listen(socketPath, resolve)
})
await chmod(socketPath, 0o600)

const dsh = spawn(
  process.execPath,
  [
    '/opt/dsh/lib/bin.js',
    '--profile', 'web',
    '--host', '127.0.0.1',
    '--port', String(webPort),
    '--trusted-host', trustedHost,
  ],
  {
    cwd: '/state/launch',
    env: process.env,
    stdio: 'inherit',
  },
)

let stopping = false
const stop = (signal) => {
  if (stopping) return
  stopping = true
  bridge.close()
  dsh.kill(signal)
  setTimeout(() => dsh.kill('SIGKILL'), 8_000).unref()
}

process.once('SIGINT', () => stop('SIGINT'))
process.once('SIGTERM', () => stop('SIGTERM'))

const { code, signal } = await new Promise((resolve) => {
  dsh.once('exit', (code, signal) => resolve({ code, signal }))
})

bridge.close()
try {
  await unlink(socketPath)
} catch (error) {
  if (error?.code !== 'ENOENT') process.stderr.write(`dsh bridge cleanup: ${error.message}\n`)
}

if (signal !== null) {
  process.stderr.write(`dsh exited from signal ${signal}\n`)
  process.exitCode = 1
} else {
  process.exitCode = code ?? 1
}
