import { z } from 'zod'
import { metadataSchemaVersion } from '../constants.js'

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
const commitShaSchema = z.string().regex(/^[0-9a-f]{40}$/)
const isoTimestampSchema = z.string().datetime({ offset: true })

export const auditSummarySchema = z
  .object({
    tool: z.string().min(1),
    invocation: z.string().min(1),
    auditedAt: isoTimestampSchema,
    totalDependencies: z.number().int().nonnegative(),
    critical: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    moderate: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    acknowledgedAt: isoTimestampSchema.nullable(),
  })
  .strict()

export const instanceRecordSchema = z
  .object({
    schemaVersion: z.literal(metadataSchemaVersion),
    managerVersion: z.string().min(1),
    id: z.string().regex(/^[0-9a-f]{32}$/),
    name: z.string().min(1).max(32),
    backend: z.literal('apple'),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    source: z
      .object({
        remote: z.url(),
        version: z.string().min(1),
        commitSha: commitShaSchema,
      })
      .strict(),
    image: z
      .object({
        reference: z.string().min(1),
        indexDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      })
      .strict(),
    kernel: z
      .object({
        path: z.string().startsWith('/'),
        sha256: sha256Schema,
        runtimeRelease: z.string().min(1),
      })
      .strict(),
    workspace: z
      .object({
        hostPath: z.string().startsWith('/'),
        guestPath: z.literal('/workspace'),
      })
      .strict(),
    resources: z
      .object({
        container: z.string().min(1),
        network: z.string().min(1),
        stateVolume: z.string().min(1),
        cacheVolume: z.string().min(1),
        proxyLabel: z.string().min(1),
      })
      .strict(),
    limits: z
      .object({
        cpus: z.number().positive(),
        memory: z.string().regex(/^\d+[KMGT]$/),
        nofile: z.number().int().positive(),
        nproc: z.number().int().positive(),
      })
      .strict(),
    security: z
      .object({
        readOnlyRoot: z.literal(true),
        droppedCapabilities: z.tuple([z.literal('ALL')]),
        publishedPorts: z.tuple([]),
        publishedSockets: z.tuple([]),
        dshGuestHost: z.literal('127.0.0.1'),
        liveEgressAcknowledgedAt: isoTimestampSchema.nullable(),
        bindRiskAcknowledgedAt: isoTimestampSchema.nullable(),
        architectureAcceptedAt: isoTimestampSchema,
      })
      .strict(),
    audit: auditSummarySchema,
    ui: z
      .object({
        guestPort: z.number().int().min(1).max(65535),
        hostPort: z.number().int().min(1).max(65535).nullable(),
        transport: z.literal('exec-stream'),
        proxyPid: z.number().int().positive().nullable(),
        proxyStartedAt: isoTimestampSchema.nullable(),
      })
      .strict(),
    lifecycle: z
      .object({
        desired: z.enum(['stopped', 'running', 'deleted']),
        observed: z.enum(['uninitialized', 'stopped', 'running', 'missing', 'drifted']),
        lastExitCode: z.number().int().nullable(),
        lastError: z.string().nullable(),
      })
      .strict(),
  })
  .strict()

export type InstanceRecord = z.infer<typeof instanceRecordSchema>
export type AuditSummary = z.infer<typeof auditSummarySchema>

export function parseInstanceRecord(value: unknown): InstanceRecord {
  return instanceRecordSchema.parse(value)
}
