#!/usr/bin/env node

import net from 'node:net'
import process from 'node:process'

const socketPath = process.argv[2]
const requestedPort = Number.parseInt(process.argv[3] ?? '0', 10)

if (socketPath === undefined || socketPath === '') {
  throw new Error('usage: host-proxy.mjs <published-unix-socket> [host-port]')
}
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
  throw new Error(`invalid host port: ${String(process.argv[3])}`)
}

const server = net.createServer({ allowHalfOpen: true }, (client) => {
  const guest = net.createConnection({ path: socketPath, allowHalfOpen: true })
  let closed = false

  const closeBoth = (error) => {
    if (closed) return
    closed = true
    if (error !== undefined) process.stderr.write(`proxy connection: ${error.message}\n`)
    client.destroy()
    guest.destroy()
  }

  client.on('error', closeBoth)
  guest.on('error', closeBoth)
  client.on('close', () => guest.destroy())
  guest.on('close', () => client.destroy())
  client.pipe(guest)
  guest.pipe(client)
})

server.on('error', (error) => {
  process.stderr.write(`proxy listener: ${error.message}\n`)
  process.exitCode = 1
})

await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen({ host: '127.0.0.1', port: requestedPort, exclusive: true }, resolve)
})

const address = server.address()
if (address === null || typeof address === 'string') throw new Error('TCP listener has no address')
process.stdout.write(`${JSON.stringify({ ready: true, host: address.address, port: address.port, socketPath })}\n`)

let stopping = false
const stop = () => {
  if (stopping) return
  stopping = true
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 8_000).unref()
}

process.once('SIGINT', stop)
process.once('SIGTERM', stop)
