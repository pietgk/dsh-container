const secretKeyPattern =
  /(?:^|[_-])(api[_-]?key|authorization|cookie|credential|password|private[_-]?key|secret|session[_-]?token|token)(?:$|[_-])/i

export function redactText(value: string): string {
  return value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/\bgh[opsu]_[A-Za-z0-9]{20,}\b/g, '[REDACTED]')
}

export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        secretKeyPattern.test(key) ? '[REDACTED]' : redactValue(nested),
      ]),
    )
  }
  return value
}
