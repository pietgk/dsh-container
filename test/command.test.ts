import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatCommand, SpawnCommandRunner } from '../src/infra/command.js'

test('command display quotes unsafe arguments without invoking a shell', () => {
  assert.equal(
    formatCommand({ executable: 'container', args: ['inspect', 'safe', 'has space', "quote'it"] }),
    "container inspect safe 'has space' 'quote'\\''it'",
  )
})

test('dry-run command runner reports without execution', async () => {
  const seen: string[] = []
  const result = await new SpawnCommandRunner({
    dryRun: true,
    onCommand: (value) => seen.push(value),
  }).run({
    executable: '/definitely/not/a/program',
    args: ['--all'],
  })
  assert.equal(result.dryRun, true)
  assert.deepEqual(seen, ['/definitely/not/a/program --all'])
})
