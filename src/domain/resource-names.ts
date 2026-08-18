const instanceNamePattern = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/
const shortInstanceNamePattern = /^[a-z]$/
const instanceIdPattern = /^[0-9a-f]{32}$/

export interface ResourceNames {
  readonly container: string
  readonly network: string
  readonly stateVolume: string
  readonly cacheVolume: string
  readonly proxyLabel: string
}

export function parseInstanceName(value: string): string {
  if (!instanceNamePattern.test(value) && !shortInstanceNamePattern.test(value)) {
    throw new Error(
      'instance name must be 1-32 lowercase ASCII letters, digits, or hyphens; start with a letter and end with a letter or digit',
    )
  }
  return value
}

export function parseInstanceId(value: string): string {
  if (!instanceIdPattern.test(value)) {
    throw new Error('instance id must be exactly 32 lowercase hexadecimal characters')
  }
  return value
}

export function deriveResourceNames(name: string, id: string): ResourceNames {
  const safeName = parseInstanceName(name)
  const safeId = parseInstanceId(id)
  const stem = `dshc-${safeName}-${safeId.slice(0, 10)}`
  return {
    container: `${stem}-ctr`,
    network: `${stem}-net`,
    stateVolume: `${stem}-state`,
    cacheVolume: `${stem}-cache`,
    proxyLabel: `${stem}-proxy`,
  }
}
