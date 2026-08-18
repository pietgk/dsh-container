import * as assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import * as net from 'node:net'
import { test } from 'node:test'
import { guestBridgeScript } from '../src/backends/apple/apple-backend.js'
import { ExecStreamProxy } from '../src/proxy/exec-stream-proxy.js'

test('exec-stream proxy binds loopback, carries raw bytes, and reaps bridge children', async () => {
  const target = net.createServer({ allowHalfOpen: true }, (socket) => socket.pipe(socket))
  target.listen({ host: '127.0.0.1', port: 0, exclusive: true })
  await once(target, 'listening')
  const targetAddress = target.address()
  if (targetAddress === null || typeof targetAddress === 'string') {
    throw new Error('target has no TCP address')
  }

  const bridgeCode = [
    "import net from 'node:net'",
    `const socket=net.createConnection({host:'127.0.0.1',port:${String(targetAddress.port)},allowHalfOpen:true})`,
    'process.stdin.pipe(socket)',
    'socket.pipe(process.stdout)',
  ].join(';')
  const proxy = new ExecStreamProxy({
    port: 0,
    bridgeFactory: () =>
      spawn(process.execPath, ['--input-type=module', '-e', bridgeCode], {
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
  })

  const address = await proxy.start()
  assert.equal(address.host, '127.0.0.1')
  const client = net.createConnection(address)
  await once(client, 'connect')
  client.write('phase-one-proxy')
  const [chunk] = (await once(client, 'data')) as [Buffer]
  assert.equal(chunk.toString('utf8'), 'phase-one-proxy')
  client.destroy()
  await waitUntil(() => proxy.activeConnections === 0)
  await proxy.stop()
  await new Promise<void>((resolve) => target.close(() => resolve()))
})

test('exec-stream proxy rejects excess connections without spawning another bridge', async () => {
  const target = net.createServer({ allowHalfOpen: true }, (socket) => socket.pipe(socket))
  target.listen({ host: '127.0.0.1', port: 0, exclusive: true })
  await once(target, 'listening')
  const targetAddress = target.address()
  if (targetAddress === null || typeof targetAddress === 'string') {
    throw new Error('target has no TCP address')
  }

  const bridgeCode = [
    "import net from 'node:net'",
    `const socket=net.createConnection({host:'127.0.0.1',port:${String(targetAddress.port)},allowHalfOpen:true})`,
    'process.stdin.pipe(socket)',
    'socket.pipe(process.stdout)',
  ].join(';')
  let bridgeCount = 0
  const proxy = new ExecStreamProxy({
    port: 0,
    maxConnections: 1,
    bridgeFactory: () => {
      bridgeCount += 1
      return spawn(process.execPath, ['--input-type=module', '-e', bridgeCode], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    },
  })

  const address = await proxy.start()
  const first = net.createConnection(address)
  await once(first, 'connect')
  first.write('held-open')
  await once(first, 'data')

  const second = net.createConnection(address)
  let response = ''
  second.on('data', (chunk: Buffer) => {
    response += chunk.toString('utf8')
  })
  await once(second, 'close')
  assert.match(response, /^HTTP\/1\.1 503 Service Unavailable/)
  assert.equal(bridgeCount, 1)
  assert.equal(proxy.activeConnections, 1)

  first.destroy()
  await waitUntil(() => proxy.activeConnections === 0)
  await proxy.stop()
  await new Promise<void>((resolve) => target.close(() => resolve()))
})

test('guest bridge reaps an idle browser connection when the guest closes keep-alive', async () => {
  const target = net.createServer((socket) => {
    socket.once('data', () => {
      socket.end(
        'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\nKeep-Alive: timeout=1\r\n\r\nok',
      )
    })
  })
  target.listen({ host: '127.0.0.1', port: 0, exclusive: true })
  await once(target, 'listening')
  const targetAddress = target.address()
  if (targetAddress === null || typeof targetAddress === 'string') {
    throw new Error('target has no TCP address')
  }

  const proxy = new ExecStreamProxy({
    port: 0,
    bridgeFactory: () =>
      spawn(
        process.execPath,
        ['--input-type=module', '-e', guestBridgeScript(targetAddress.port)],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      ),
  })
  const address = await proxy.start()
  const client = net.createConnection(address)
  await once(client, 'connect')
  client.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n')
  const [response] = (await once(client, 'data')) as [Buffer]
  assert.match(response.toString('utf8'), /\r\n\r\nok$/)
  await Promise.race([
    once(client, 'close'),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('idle browser connection was not closed')), 2_000)
    }),
  ])
  await waitUntil(() => proxy.activeConnections === 0)

  await proxy.stop()
  await new Promise<void>((resolve) => target.close(() => resolve()))
})

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for proxy child cleanup')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
