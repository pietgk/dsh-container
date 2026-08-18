import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import * as path from 'node:path'
import {
  instanceJournalPath,
  instanceRecordPath,
  type ManagerPaths,
} from '../config/manager-paths.js'
import { type InstanceRecord, parseInstanceRecord } from '../domain/instance-record.js'
import { redactValue } from '../security/redact.js'

export interface JournalEntry {
  readonly at: string
  readonly operation: string
  readonly stage: string
  readonly status: 'started' | 'completed' | 'failed'
  readonly targets: readonly string[]
  readonly detail?: unknown
}

export class InstanceStore {
  readonly #paths: ManagerPaths

  constructor(paths: ManagerPaths) {
    this.#paths = paths
  }

  async read(name: string): Promise<InstanceRecord | null> {
    try {
      const raw = await readFile(instanceRecordPath(this.#paths, name), 'utf8')
      return parseInstanceRecord(JSON.parse(raw) as unknown)
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return null
      throw error
    }
  }

  async write(record: InstanceRecord): Promise<void> {
    const parsed = parseInstanceRecord(record)
    await mkdir(this.#paths.instances, { recursive: true, mode: 0o700 })
    const destination = instanceRecordPath(this.#paths, parsed.name)
    const temporary = path.join(
      this.#paths.instances,
      `.${parsed.name}.${randomUUID().replaceAll('-', '')}.tmp`,
    )
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(temporary, destination)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  }

  async appendJournal(name: string, entry: JournalEntry): Promise<void> {
    await mkdir(this.#paths.journals, { recursive: true, mode: 0o700 })
    const journalPath = instanceJournalPath(this.#paths, name)
    const handle = await open(journalPath, 'a', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(redactValue(entry))}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
