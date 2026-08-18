import { z } from 'zod'

const inspectSchema = z
  .array(
    z.object({
      configuration: z.object({
        capDrop: z.array(z.string()),
        readOnly: z.boolean(),
        publishedPorts: z.array(z.unknown()),
        publishedSockets: z.array(z.unknown()),
        initProcess: z.object({
          user: z.union([
            z.object({ raw: z.object({ userString: z.string() }) }),
            z.object({ id: z.object({ uid: z.number().int(), gid: z.number().int() }) }),
          ]),
          rlimits: z.array(z.object({ limit: z.string(), soft: z.number(), hard: z.number() })),
        }),
      }),
    }),
  )
  .min(1)

export interface InspectPolicyResult {
  readonly accepted: boolean
  readonly failures: readonly string[]
}

const imageInspectSchema = z
  .array(
    z.object({
      id: z.string(),
      configuration: z.object({ descriptor: z.object({ digest: z.string() }) }),
    }),
  )
  .min(1)

export function verifyImageIdentity(input: unknown, expectedDigest: string): InspectPolicyResult {
  const parsed = imageInspectSchema.safeParse(input)
  if (!parsed.success)
    return { accepted: false, failures: ['unrecognized Apple image inspect response'] }
  const image = parsed.data[0]
  if (image === undefined) return { accepted: false, failures: ['missing image inspection'] }
  const expectedId = expectedDigest.replace(/^sha256:/, '')
  const failures: string[] = []
  if (image.configuration.descriptor.digest !== expectedDigest) {
    failures.push(`image descriptor digest is ${image.configuration.descriptor.digest}`)
  }
  if (image.id !== expectedId) failures.push(`image id is ${image.id}`)
  return { accepted: failures.length === 0, failures }
}

export function verifyInspectPolicy(input: unknown): InspectPolicyResult {
  const parsed = inspectSchema.safeParse(input)
  if (!parsed.success) return { accepted: false, failures: ['unrecognized Apple inspect response'] }

  const configuration = parsed.data[0]?.configuration
  if (configuration === undefined) return { accepted: false, failures: ['missing configuration'] }
  const failures: string[] = []
  if (!configuration.readOnly) failures.push('root filesystem is not read-only')
  if (!configuration.capDrop.includes('ALL')) failures.push('capability drop ALL is missing')
  if (configuration.publishedPorts.length !== 0) failures.push('container has published ports')
  if (configuration.publishedSockets.length !== 0) failures.push('container has published sockets')
  const user = configuration.initProcess.user
  const acceptedUser =
    ('raw' in user && user.raw.userString === '1000:1000') ||
    ('id' in user && user.id.uid === 1000 && user.id.gid === 1000)
  if (!acceptedUser) {
    failures.push('container user is not 1000:1000')
  }
  const limits = new Map(
    configuration.initProcess.rlimits.map((limit) => [limit.limit, [limit.soft, limit.hard]]),
  )
  if (limits.get('RLIMIT_NPROC')?.[0] !== 512 || limits.get('RLIMIT_NPROC')?.[1] !== 512) {
    failures.push('RLIMIT_NPROC is not 512:512')
  }
  if (limits.get('RLIMIT_NOFILE')?.[0] !== 1024 || limits.get('RLIMIT_NOFILE')?.[1] !== 1024) {
    failures.push('RLIMIT_NOFILE is not 1024:1024')
  }
  return { accepted: failures.length === 0, failures }
}
