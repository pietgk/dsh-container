#!/usr/bin/env node

import net from 'node:net'
import process from 'node:process'
import { spawn } from 'node:child_process'

const containerId = process.argv[2]
const requestedPort = Number.parseInt(process.argv[3] ?? '0', 10)

if (containerId === undefined || containerId === '') {
  throw new Error('usage: host-proxy-exec.mjs <container-id> [host-port]')
}
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
  throw new Error(`invalid host port: ${String(process.argv[3])}`)
}

const guestBridge = [
  "import net from 'node:net'",
  "const socket=net.createConnection({host:'127.0.0.1',port:3080,allowHalfOpen:true})",
  "socket.on('error',error=>{console.error(error.message);process.exitCode=1})",
  'process.stdin.pipe(socket)',
  'socket.pipe(process.stdout)',
].join(';')

const connections = new Set()
const server = net.createServer({ allowHalfOpen: true }, (client) => {
  const child = spawn('container', [
    'exec', '--interactive', containerId,
    'node', '--input-type=module', '-e', guestBridge,
  ], { stdio: ['pipe', 'pipe', 'pipe'] })
  const connection = { child, client }
  connections.add(connection)

  client.on('error', () => child.stdin.destroy())
  client.on('close', () => child.stdin.end())
  child.on('error', (error) => {
    process.stderr.write(`exec bridge: ${error.message}\n`)
    client.destroy()
  })
  child.stderr.on('data', (chunk) => process.stderr.write(`exec bridge: ${chunk.toString()}`))
  child.on('close', () => {
    connections.delete(connection)
    client.end()
  })

  client.pipe(child.stdin)
  child.stdout.pipe(client)
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
process.stdout.write(`${JSON.stringify({ ready: true, host: address.address, port: address.port, containerId, transport: 'exec' })}\n`)

let stopping = false
const stop = () => {
  if (stopping) return
  stopping = true
  for (const { child, client } of connections) {
    client.destroy()
    child.stdin.end()
  }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 8_000).unref()
}

process.once('SIGINT', stop)
process.once('SIGTERM', stop)
