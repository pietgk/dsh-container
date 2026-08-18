import * as path from 'node:path'
import { projectRoot } from '../constants.js'
import { parseInstanceName } from '../domain/resource-names.js'

export interface ManagerPaths {
  readonly root: string
  readonly instances: string
  readonly journals: string
  readonly logs: string
}

export function resolveManagerPaths(override?: string): ManagerPaths {
  const root = path.resolve(
    override ?? process.env.DSH_CONTAINER_HOME ?? path.join(projectRoot, '.state/manager'),
  )
  return {
    root,
    instances: path.join(root, 'instances'),
    journals: path.join(root, 'journals'),
    logs: path.join(root, 'logs'),
  }
}

export function instanceRecordPath(paths: ManagerPaths, name: string): string {
  return path.join(paths.instances, `${parseInstanceName(name)}.json`)
}

export function instanceJournalPath(paths: ManagerPaths, name: string): string {
  return path.join(paths.journals, `${parseInstanceName(name)}.ndjson`)
}
