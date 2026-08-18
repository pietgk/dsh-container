import { stat } from 'node:fs/promises'
import type { BackendProbe } from '../backends/backend.js'
import { AppleBackend } from '../backends/apple/apple-backend.js'
import { verifyImageIdentity } from '../backends/apple/inspect-policy.js'
import { acceptedDsh, acceptedKernel } from '../constants.js'
import { type CommandRunner, SpawnCommandRunner } from '../infra/command.js'
import { sha256File } from '../infra/sha256.js'

export interface DoctorCheck {
  readonly name: string
  readonly status: 'pass' | 'fail'
  readonly detail: string
}

export interface DoctorReport {
  readonly accepted: boolean
  readonly backend: BackendProbe
  readonly checks: readonly DoctorCheck[]
}

export async function runDoctor(
  backend = new AppleBackend(),
  runner: CommandRunner = new SpawnCommandRunner(),
): Promise<DoctorReport> {
  const probe = await backend.probeHost()
  const checks: DoctorCheck[] = [
    {
      name: 'Apple Container CLI',
      status: probe.available ? 'pass' : 'fail',
      detail: probe.version ?? probe.detail,
    },
    {
      name: 'Apple Container API service',
      status: probe.serviceRunning ? 'pass' : 'fail',
      detail: probe.detail,
    },
  ]

  try {
    const kernelStat = await stat(acceptedKernel.path)
    const digest = await sha256File(acceptedKernel.path)
    checks.push({
      name: 'Pinned Landlock kernel',
      status: digest === acceptedKernel.sha256 ? 'pass' : 'fail',
      detail: `${kernelStat.size} bytes, sha256:${digest}`,
    })
  } catch (error) {
    checks.push({
      name: 'Pinned Landlock kernel',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    const image = await runner.run({
      executable: 'container',
      args: ['image', 'inspect', acceptedDsh.imageReference],
    })
    if (image.exitCode !== 0) throw new Error(image.stderr.trim() || 'image inspection failed')
    const identity = verifyImageIdentity(
      JSON.parse(image.stdout) as unknown,
      acceptedDsh.imageIndexDigest,
    )
    checks.push({
      name: 'Accepted DSH image',
      status: identity.accepted ? 'pass' : 'fail',
      detail: identity.accepted ? acceptedDsh.imageIndexDigest : identity.failures.join('; '),
    })
  } catch (error) {
    checks.push({
      name: 'Accepted DSH image',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  return { accepted: checks.every((check) => check.status === 'pass'), backend: probe, checks }
}
