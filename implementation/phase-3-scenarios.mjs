#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const baseUrl = process.env.DSH_PHASE3_URL ?? 'http://127.0.0.1:30081'
const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const managerCli = process.env.DSH_CONTAINER_CLI ?? `${homedir()}/.local/bin/dsh-container`
const managerHome = process.env.DSH_CONTAINER_HOME ?? `${projectRoot}/.state/manager`
const workspaceId = process.env.DSH_PHASE3_WORKSPACE_ID

if (!workspaceId) throw new Error('DSH_PHASE3_WORKSPACE_ID is required')

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function rpc(method, payload) {
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `phase3-${method}-${crypto.randomUUID()}`,
      method,
      payload,
    }),
  })
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`)
  const envelope = await response.json()
  if (envelope?.result?.ok !== true) {
    throw new Error(`${method} failed: ${JSON.stringify(envelope?.result?.error)}`)
  }
  return envelope.result.value
}

async function history(sessionId) {
  return await rpc('session.history', { sessionId, maxMessages: 100 })
}

function lastSeq(page) {
  return page.events.at(-1)?.event?.seq ?? -1
}

function textOf(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

function summarizeTurn(page, afterSeq) {
  const events = page.events.map((entry) => entry.event).filter((event) => event.seq > afterSeq)
  const assistant = events
    .filter((event) => event.type === 'assistant/message')
    .map((event) => textOf(event.data?.message))
    .filter(Boolean)
  const toolCalls = events
    .filter((event) => event.type === 'tool/call')
    .map((event) => event.data?.name)
    .filter((name) => typeof name === 'string')
  const toolErrors = events.filter(
    (event) => event.type === 'tool/result' && event.data?.message?.content?.some?.(
      (block) => block?.type === 'tool-result' && block.isError === true,
    ),
  ).length
  const end = events.findLast((event) => event.type === 'turn/end')
  return {
    eventCount: events.length,
    toolCalls,
    toolErrors,
    endReason: end?.data?.reason,
    assistant: assistant.at(-1),
    projections: page.projections?.values?.sessionStats,
  }
}

async function runTurn(sessionId, label, prompt) {
  const before = await history(sessionId)
  const afterSeq = lastSeq(before)
  const startedAt = performance.now()
  await rpc('session.prompt', {
    sessionId,
    mode: 'queue',
    clientTimeZone: 'Europe/Stockholm',
    content: [{ type: 'text', text: prompt }],
  })

  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    const page = await history(sessionId)
    if (page.events.some((entry) => entry.event.seq > afterSeq && entry.event.type === 'turn/end')) {
      return {
        label,
        elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
        ...summarizeTurn(page, afterSeq),
      }
    }
    await sleep(500)
  }
  throw new Error(`${label} did not finish within five minutes`)
}

async function restartManagedInstance() {
  const common = ['--name', 'evaluation', '--home', managerHome]
  const startedAt = performance.now()
  await execFileAsync(managerCli, ['stop', ...common])
  await execFileAsync(managerCli, ['start', ...common])
  return Number((performance.now() - startedAt).toFixed(1))
}

const created = await rpc('session.create', { workspaceId })
const sessionId = created.sessionId
const turns = []

turns.push(await runTurn(
  sessionId,
  'inspect',
  'Inspect /workspace/phase3-app as a small application. Do not modify any files. Run its tests. Report its architecture, public behavior, notable risks, and the exact test result. Keep the report concise.',
))

turns.push(await runTurn(
  sessionId,
  'constrained-change',
  'Make one constrained change in /workspace/phase3-app: add an exported decrement(value) function that follows the same integer validation contract as increment, and add tests for successful decrement and non-integer rejection. Change only src/counter.js and test/counter.test.js. Run npm test. Do not modify any other files.',
))

turns.push(await runTurn(
  sessionId,
  'composition-discovery',
  'Without modifying workspace files, discover the DSH skill or preset support relevant to Cordis plugin composition. Use the available discovery tools, identify the shipped composition-editing skill or preset if present, and summarize what it is for. Do not copy or edit presets.',
))

const restartMs = await restartManagedInstance()

turns.push(await runTurn(
  sessionId,
  'persisted-resume',
  'This session has just crossed a managed container restart. Confirm continuity by stating the prior code change, inspect the current fixture files, and run npm test. Do not modify any files.',
))

console.log(JSON.stringify({ sessionId, restartMs, turns }, null, 2))
