import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyImageIdentity, verifyInspectPolicy } from '../src/backends/apple/inspect-policy.js'

function acceptedInspect(): unknown {
  return [
    {
      configuration: {
        capDrop: ['ALL'],
        readOnly: true,
        publishedPorts: [],
        publishedSockets: [],
        initProcess: {
          user: { raw: { userString: '1000:1000' } },
          rlimits: [
            { limit: 'RLIMIT_NPROC', soft: 512, hard: 512 },
            { limit: 'RLIMIT_NOFILE', soft: 1024, hard: 1024 },
          ],
        },
      },
    },
  ]
}

test('inspect policy accepts the proven runtime shape', () => {
  assert.deepEqual(verifyInspectPolicy(acceptedInspect()), { accepted: true, failures: [] })
})

test('inspect policy accepts Apple numeric UID/GID representation', () => {
  const input = acceptedInspect() as Array<{
    configuration: { initProcess: { user: unknown } }
  }>
  const configuration = input[0]?.configuration
  if (configuration === undefined) throw new Error('missing test configuration')
  configuration.initProcess.user = { id: { uid: 1000, gid: 1000 } }
  assert.equal(verifyInspectPolicy(input).accepted, true)
})

test('inspect policy reports network publication and writable root drift', () => {
  const input = acceptedInspect() as Array<{ configuration: Record<string, unknown> }>
  const configuration = input[0]?.configuration
  if (configuration === undefined) throw new Error('missing test configuration')
  configuration.readOnly = false
  configuration.publishedPorts = [{ hostPort: 3080 }]
  const result = verifyInspectPolicy(input)
  assert.equal(result.accepted, false)
  assert.ok(result.failures.includes('root filesystem is not read-only'))
  assert.ok(result.failures.includes('container has published ports'))
})

test('image identity requires both Apple id and descriptor digest to match', () => {
  const digest = 'sha256:a9f384b239d75d6aca3448a7bb4ead0d6697fb9271e4b46b78849254dd4afc39'
  const accepted = verifyImageIdentity(
    [
      {
        id: digest.replace('sha256:', ''),
        configuration: { descriptor: { digest } },
      },
    ],
    digest,
  )
  assert.equal(accepted.accepted, true)
  assert.equal(
    verifyImageIdentity(
      [{ id: 'wrong', configuration: { descriptor: { digest: 'sha256:wrong' } } }],
      digest,
    ).accepted,
    false,
  )
})
