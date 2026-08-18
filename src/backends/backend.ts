import type { CommandSpec } from '../infra/command.js'
import type { InstanceRecord } from '../domain/instance-record.js'

export interface BackendProbe {
  readonly backend: 'apple'
  readonly available: boolean
  readonly version: string | null
  readonly serviceRunning: boolean
  readonly detail: string
}

export interface BackendCommandPlan {
  readonly createNetwork: CommandSpec
  readonly createStateVolume: CommandSpec
  readonly createCacheVolume: CommandSpec
  readonly createContainer: CommandSpec
}

export interface Backend {
  probeHost(): Promise<BackendProbe>
  planCreate(record: InstanceRecord): BackendCommandPlan
  startCommand(record: InstanceRecord): CommandSpec
  stopCommand(record: InstanceRecord): CommandSpec
  inspectCommand(record: InstanceRecord): CommandSpec
  logsCommand(record: InstanceRecord, follow: boolean, lines?: number): CommandSpec
}
