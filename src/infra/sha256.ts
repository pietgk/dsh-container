import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(filePath)
    input.once('error', reject)
    input.on('data', (chunk) => hash.update(chunk))
    input.once('end', resolve)
  })
  return hash.digest('hex')
}

export async function verifySha256(filePath: string, expected: string): Promise<void> {
  const observed = await sha256File(filePath)
  if (observed !== expected) {
    throw new Error(`SHA-256 mismatch for ${filePath}: expected ${expected}, observed ${observed}`)
  }
}
