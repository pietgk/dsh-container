import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import * as path from 'node:path'
import {
  acceptedAudit,
  acceptedDsh,
  acceptedKernel,
  defaultLimits,
  guestPaths,
  managerVersion,
  metadataSchemaVersion,
  projectRoot,
} from '../constants.js'
import { type InstanceRecord, parseInstanceRecord } from '../domain/instance-record.js'
import { deriveResourceNames, parseInstanceName } from '../domain/resource-names.js'

export interface PlanInstanceInput {
  readonly name: string
  readonly workspace: string
  readonly now?: Date
  readonly id?: string
}

export function planInstance(input: PlanInstanceInput): InstanceRecord {
  const name = parseInstanceName(input.name)
  const workspace = resolveManagedWorkspace(input.workspace)
  const id = input.id ?? randomBytes(16).toString('hex')
  const resources = deriveResourceNames(name, id)
  const now = (input.now ?? new Date()).toISOString()
  return parseInstanceRecord({
    schemaVersion: metadataSchemaVersion,
    managerVersion,
    id,
    name,
    backend: 'apple',
    createdAt: now,
    updatedAt: now,
    source: {
      remote: acceptedDsh.remote,
      version: acceptedDsh.version,
      commitSha: acceptedDsh.sha,
    },
    image: {
      reference: acceptedDsh.imageReference,
      indexDigest: acceptedDsh.imageIndexDigest,
    },
    kernel: {
      path: acceptedKernel.path,
      sha256: acceptedKernel.sha256,
      runtimeRelease: acceptedKernel.runtimeRelease,
    },
    workspace: {
      hostPath: workspace,
      guestPath: guestPaths.workspace,
    },
    resources,
    limits: {
      cpus: defaultLimits.cpus,
      memory: defaultLimits.memory,
      nofile: defaultLimits.nofile,
      nproc: defaultLimits.nproc,
    },
    security: {
      readOnlyRoot: true,
      droppedCapabilities: ['ALL'],
      publishedPorts: [],
      publishedSockets: [],
      dshGuestHost: '127.0.0.1',
      liveEgressAcknowledgedAt: null,
      bindRiskAcknowledgedAt: null,
      architectureAcceptedAt: now,
    },
    audit: {
      tool: 'pnpm audit',
      invocation: 'pnpm audit --prod --json',
      auditedAt: now,
      totalDependencies: acceptedAudit.totalDependencies,
      critical: acceptedAudit.critical,
      high: acceptedAudit.high,
      moderate: acceptedAudit.moderate,
      low: acceptedAudit.low,
      acknowledgedAt: now,
    },
    ui: {
      guestPort: 3080,
      hostPort: null,
      transport: 'exec-stream',
      proxyPid: null,
      proxyStartedAt: null,
    },
    lifecycle: {
      desired: 'stopped',
      observed: 'uninitialized',
      lastExitCode: null,
      lastError: null,
    },
  })
}

export function resolveManagedWorkspace(value: string): string {
  const managedRoot = resolveManagedWorkspaceRoot()
  const resolved = path.resolve(value)
  const relative = path.relative(managedRoot, resolved)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`workspace must be a named directory below ${managedRoot}`)
  }
  return resolved
}

export function resolveManagedWorkspaceRoot(
  packageRoot: string = projectRoot,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const home = environment.HOME ?? homedir()
  const root =
    environment.DSH_CONTAINER_WORKSPACE_ROOT ??
    (packageRoot.startsWith('/nix/store/')
      ? path.join(home, '.local/share/dsh-container/workspaces')
      : path.join(packageRoot, 'workspaces'))
  return path.resolve(root)
}
