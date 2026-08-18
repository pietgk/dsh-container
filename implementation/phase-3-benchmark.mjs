#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor((sorted.length - 1) * fraction)]
}

function summarize(values) {
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    count: values.length,
    meanMs: Number((total / values.length).toFixed(3)),
    minMs: Number(Math.min(...values).toFixed(3)),
    p50Ms: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
  }
}

async function requestRoot(baseUrl) {
  const startedAt = performance.now()
  const response = await fetch(`${baseUrl}/`)
  await response.arrayBuffer()
  if (!response.ok) throw new Error(`root returned HTTP ${response.status}`)
  return performance.now() - startedAt
}

async function requestWorkspaceList(baseUrl, sequence) {
  const startedAt = performance.now()
  const response = await fetch(`${baseUrl}/api/workspace.list`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `phase3-${sequence}`,
      method: 'workspace.list',
      payload: {},
    }),
  })
  const body = await response.json()
  if (!response.ok || body?.result?.ok !== true) {
    throw new Error(`workspace.list failed: HTTP ${response.status} ${JSON.stringify(body)}`)
  }
  return { elapsedMs: performance.now() - startedAt, value: body.result.value }
}

async function waitForHttp(baseUrl, timeoutMs = 30_000) {
  const deadline = performance.now() + timeoutMs
  let lastError
  while (performance.now() < deadline) {
    try {
      await requestRoot(baseUrl)
      return
    } catch (error) {
      lastError = error
      await sleep(25)
    }
  }
  throw new Error(`HTTP readiness timed out: ${lastError}`)
}

async function benchmarkHttp(
  baseUrl,
  sequentialCount = Number(process.env.BENCHMARK_SEQUENTIAL ?? '100'),
  concurrentCount = Number(process.env.BENCHMARK_CONCURRENCY ?? '64'),
) {
  for (let index = 0; index < 5; index += 1) {
    await requestRoot(baseUrl)
    await requestWorkspaceList(baseUrl, `warmup-${index}`)
  }

  const rootTimes = []
  const rpcTimes = []
  for (let index = 0; index < sequentialCount; index += 1) {
    rootTimes.push(await requestRoot(baseUrl))
  }
  for (let index = 0; index < sequentialCount; index += 1) {
    rpcTimes.push((await requestWorkspaceList(baseUrl, `sequential-${index}`)).elapsedMs)
  }

  const concurrentStartedAt = performance.now()
  const concurrentTimes = await Promise.all(
    Array.from({ length: concurrentCount }, () => requestRoot(baseUrl)),
  )

  return {
    baseUrl,
    sequentialRoot: summarize(rootTimes),
    sequentialWorkspaceList: summarize(rpcTimes),
    concurrentRoot: {
      ...summarize(concurrentTimes),
      wallMs: Number((performance.now() - concurrentStartedAt).toFixed(3)),
    },
  }
}

async function guestPressure(containerName) {
  if (!containerName) return null
  const { stdout } = await execFileAsync('container', [
    'exec',
    containerName,
    '/bin/sh',
    '-c',
    'printf "memory="; cat /sys/fs/cgroup/memory.current; printf "pids="; cat /sys/fs/cgroup/pids.current',
  ])
  return stdout.trim()
}

async function benchmarkBurstSeries(baseUrl) {
  const levels = (process.env.BENCHMARK_LEVELS ?? '16,32,48')
    .split(',')
    .map((value) => Number(value))
  const results = []
  for (const count of levels) {
    const startedAt = performance.now()
    const settled = await Promise.allSettled(
      Array.from({ length: count }, () => requestRoot(baseUrl)),
    )
    results.push({
      count,
      succeeded: settled.filter((result) => result.status === 'fulfilled').length,
      failed: settled.filter((result) => result.status === 'rejected').length,
      failureReasons: [
        ...new Set(
          settled
            .filter((result) => result.status === 'rejected')
            .map((result) => String(result.reason)),
        ),
      ],
      wallMs: Number((performance.now() - startedAt).toFixed(3)),
      guestPressure: await guestPressure(process.env.LOAD_CONTAINER),
    })
    await sleep(1_000)
  }
  return { mode: 'burst-series', baseUrl, results }
}

async function processSnapshot(pid) {
  const { stdout } = await execFileAsync('/bin/ps', ['-o', 'pid=,ppid=,rss=,%cpu=,etime=,command=', '-p', String(pid)])
  return stdout.trim()
}

async function stopChild(child) {
  const startedAt = performance.now()
  child.kill('SIGTERM')
  const timeout = sleep(10_000).then(() => 'timeout')
  const exited = once(child, 'exit').then(() => 'exit')
  if ((await Promise.race([timeout, exited])) === 'timeout') {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
  return Number((performance.now() - startedAt).toFixed(3))
}

async function benchmarkNative() {
  const dshBin = process.env.NATIVE_DSH_BIN
  const dshHome = process.env.NATIVE_DSH_HOME
  const port = Number(process.env.NATIVE_DSH_PORT ?? '30083')
  if (!dshBin || !dshHome) throw new Error('NATIVE_DSH_BIN and NATIVE_DSH_HOME are required')

  const baseUrl = `http://127.0.0.1:${port}`
  const cycles = []
  let lastChild
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const startedAt = performance.now()
    const child = spawn(
      process.execPath,
      [
        '--expose-internals',
        dshBin,
        '--profile',
        'web',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--trusted-host',
        `127.0.0.1:${port}`,
      ],
      {
        env: { ...process.env, DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk.toString() })
    child.stderr.on('data', (chunk) => { output += chunk.toString() })
    const earlyExit = once(child, 'exit').then(([code]) => {
      throw new Error(`native DSH exited early with ${code}: ${output}`)
    })
    await Promise.race([waitForHttp(baseUrl), earlyExit])
    const startupMs = Number((performance.now() - startedAt).toFixed(3))
    const workspace = (await requestWorkspaceList(baseUrl, `native-cycle-${cycle}`)).value
    const snapshot = await processSnapshot(child.pid)
    const stopMs = await stopChild(child)
    cycles.push({ cycle, startupMs, stopMs, workspace, process: snapshot })
    lastChild = child
  }
  if (lastChild?.exitCode === null) await stopChild(lastChild)

  const child = spawn(
    process.execPath,
    [
      '--expose-internals',
      dshBin,
      '--profile',
      'web',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--trusted-host',
      `127.0.0.1:${port}`,
    ],
    {
      env: { ...process.env, DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  await waitForHttp(baseUrl)
  const http = await benchmarkHttp(baseUrl)
  const finalProcess = await processSnapshot(child.pid)
  const finalStopMs = await stopChild(child)
  return { mode: 'native', cycles, http, finalProcess, finalStopMs }
}

async function managerStatus(cli, managerHome) {
  const { stdout } = await execFileAsync(cli, [
    'status',
    '--name',
    'evaluation',
    '--home',
    managerHome,
    '--json',
  ])
  return JSON.parse(stdout)
}

async function runManager(cli, managerHome, action) {
  const startedAt = performance.now()
  await execFileAsync(cli, [action, '--name', 'evaluation', '--home', managerHome])
  return Number((performance.now() - startedAt).toFixed(3))
}

async function benchmarkContainer() {
  const cli = process.env.DSH_CONTAINER_CLI
  const managerHome = process.env.DSH_CONTAINER_HOME
  if (!cli || !managerHome) throw new Error('DSH_CONTAINER_CLI and DSH_CONTAINER_HOME are required')

  const initial = await managerStatus(cli, managerHome)
  if (!initial.ready || !initial.uiUrl) throw new Error('evaluation instance is not initially ready')
  const baselineWorkspace = (await requestWorkspaceList(initial.uiUrl.replace(/\/$/, ''), 'container-baseline')).value
  const cycles = []

  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const stopMs = await runManager(cli, managerHome, 'stop')
    const stopped = await managerStatus(cli, managerHome)
    if (stopped.runtimeState !== 'stopped' || stopped.ready) {
      throw new Error(`cycle ${cycle} did not reach stopped state`)
    }
    const startMs = await runManager(cli, managerHome, 'start')
    const started = await managerStatus(cli, managerHome)
    if (!started.ready || !started.uiUrl) throw new Error(`cycle ${cycle} did not become ready`)
    const baseUrl = started.uiUrl.replace(/\/$/, '')
    const workspace = (await requestWorkspaceList(baseUrl, `container-cycle-${cycle}`)).value
    if (JSON.stringify(workspace) !== JSON.stringify(baselineWorkspace)) {
      throw new Error(`cycle ${cycle} changed persistent workspace/session state`)
    }
    cycles.push({ cycle, stopMs, startMs, proxyPid: started.record.ui.proxyPid })
  }

  const finalStatus = await managerStatus(cli, managerHome)
  const baseUrl = finalStatus.uiUrl.replace(/\/$/, '')
  const http = await benchmarkHttp(baseUrl)
  const proxyProcess = await processSnapshot(finalStatus.record.ui.proxyPid)
  const { stdout: guestResources } = await execFileAsync('container', [
    'exec',
    finalStatus.record.resources.container,
    '/bin/sh',
    '-c',
    'for f in /sys/fs/cgroup/memory.current /sys/fs/cgroup/pids.current /sys/fs/cgroup/cpu.stat; do echo ===$f; cat $f; done; set -- /proc/[0-9]*; echo ===process-count; echo $#',
  ])

  return {
    mode: 'container',
    baselineWorkspace,
    cycles,
    http,
    proxyProcess,
    guestResources: guestResources.trim(),
    finalStatus: {
      ready: finalStatus.ready,
      runtimeState: finalStatus.runtimeState,
      directGuestReachable: finalStatus.directGuestReachable,
      uiUrl: finalStatus.uiUrl,
    },
  }
}

const mode = process.argv[2]
const result = mode === 'native'
  ? await benchmarkNative()
  : mode === 'container'
    ? await benchmarkContainer()
    : mode === 'load'
      ? await benchmarkBurstSeries(process.argv[3] ?? 'http://127.0.0.1:30081')
      : await benchmarkHttp(process.argv[2] ?? 'http://127.0.0.1:30081')

console.log(JSON.stringify(result, null, 2))
