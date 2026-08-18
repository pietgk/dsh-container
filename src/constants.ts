import { fileURLToPath } from 'node:url'

export const managerVersion = '0.1.0'
export const metadataSchemaVersion = 1 as const

export const projectRoot = fileURLToPath(new URL('..', import.meta.url))

export const acceptedDsh = {
  remote: 'https://github.com/deepseek-ai/deepseek-harness.git',
  version: '0.1.0-rc.7',
  sha: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca',
  imageReference: 'docker.io/library/dsh-spike-b:99f6f02',
  imageIndexDigest: 'sha256:a9f384b239d75d6aca3448a7bb4ead0d6697fb9271e4b46b78849254dd4afc39',
  landlockLauncher:
    '/opt/dsh/node_modules/.pnpm/@deepseek-ai+node-addon-landlock-run-linux-arm64@file++++src+native+landlock-run+packages+linux-arm64/node_modules/@deepseek-ai/node-addon-landlock-run-linux-arm64/bin/landlock-run',
} as const

export const acceptedKernel = {
  path: fileURLToPath(new URL('../spikes/phase-0/apple-kernel/vmlinux-arm64', import.meta.url)),
  sha256: '5ac12b28ec01f5ed89f4a6397a29a422b3e615f2b382d8ec328991b1a3953d1b',
  runtimeRelease: '6.18.5-cz-7800b4642171',
  sourceRevision: '7800b4642171561c95b5f55500b19e5dce5acd45',
} as const

export const acceptedAudit = {
  totalDependencies: 437,
  critical: 0,
  high: 12,
  moderate: 12,
  low: 1,
  acknowledgedAt: '2026-08-17',
} as const

export const defaultLimits = {
  cpus: 2,
  memory: '2G',
  nofile: 1024,
  nproc: 512,
  stateVolumeSize: '4G',
  cacheVolumeSize: '8G',
} as const

export const guestPaths = {
  workspace: '/workspace',
  state: '/state',
  cache: '/cache',
  temporary: '/tmp',
  workdir: '/state/launch',
  dshHome: '/state/dsh',
} as const
