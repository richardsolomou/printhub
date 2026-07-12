import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'

function encryptionKey() {
  const configured = process.env.RECOVERY_ENCRYPTION_KEY
  if (!configured) return undefined
  const key = /^[a-f\d]{64}$/i.test(configured) ? Buffer.from(configured, 'hex') : Buffer.from(configured, 'base64')
  if (key.length !== 32) throw new Error('RECOVERY_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters or base64')
  return key
}

function tar(args: string[], cwd: string, input?: NodeJS.ReadableStream) {
  const child = spawn('tar', args, { cwd, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'inherit'] })
  if (input) input.pipe(child.stdin!)
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited with status ${code}`))))
  })
  return { child, exited }
}

export function recoveryEncryptionConfigured() {
  return encryptionKey() !== undefined
}

export async function encryptBackupDirectory(directory: string) {
  const key = encryptionKey()
  if (!key) return false
  const encrypted = `${directory}.encrypted`
  fs.mkdirSync(encrypted, { recursive: true, mode: 0o700 })
  try {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const archive = tar(['-cf', '-', '.'], directory)
    await Promise.all([
      pipeline(archive.child.stdout!, cipher, fs.createWriteStream(path.join(encrypted, 'bundle.tar.enc'), { mode: 0o600 })),
      archive.exited,
    ])
    fs.writeFileSync(
      path.join(encrypted, 'envelope.json'),
      `${JSON.stringify({ format: 1, algorithm: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') }, null, 2)}\n`,
      { mode: 0o600 },
    )
    fs.rmSync(directory, { recursive: true, force: true })
    fs.renameSync(encrypted, directory)
    return true
  } catch (error) {
    fs.rmSync(encrypted, { recursive: true, force: true })
    throw error
  }
}

export async function materializeBackupDirectory(directory: string) {
  const envelopeFile = path.join(directory, 'envelope.json')
  if (!fs.existsSync(envelopeFile)) return { directory, cleanup: async () => undefined, encrypted: false }
  const key = encryptionKey()
  if (!key) throw new Error('RECOVERY_ENCRYPTION_KEY is required to verify or restore this encrypted backup')
  const envelope = JSON.parse(fs.readFileSync(envelopeFile, 'utf8')) as { iv: string; tag: string }
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-restore-'))
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  const archiveFile = path.join(temporary, 'bundle.tar')
  await pipeline(fs.createReadStream(path.join(directory, 'bundle.tar.enc')), decipher, fs.createWriteStream(archiveFile, { mode: 0o600 }))
  const extracted = path.join(temporary, 'bundle')
  fs.mkdirSync(extracted)
  const archive = tar(['-xf', archiveFile, '-C', extracted], temporary)
  await archive.exited
  return { directory: extracted, cleanup: () => fs.promises.rm(temporary, { recursive: true, force: true }), encrypted: true }
}
