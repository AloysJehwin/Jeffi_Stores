import 'server-only'
import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import type { StorageDriver, SignedGetOptions } from './storage'
import { repoPath } from '@/lib/shared/paths'

// Dev/test storage: files on local disk, served through /api/vault/local with a short-lived HMAC
// token so the access path mirrors the presigned-URL model (no auth bypass, time-limited).

const ROOT = process.env.VAULT_LOCAL_DIR || repoPath('.vault-store')
const SECRET = process.env.VAULT_LOCAL_SECRET || process.env.AUTH_SECRET || 'dev-vault-secret'

function diskPath(key: string): string {
  // key is vault/<tenant>/<product>/<file>; keep it flat-safe, never escape ROOT.
  const safe = key.replace(/\.\./g, '').replace(/^\/+/, '')
  return path.join(ROOT, safe)
}

export function signLocalToken(key: string, expiresAt: number, disposition: string): string {
  const payload = `${key}|${expiresAt}|${disposition}`
  const sig = createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32)
  return Buffer.from(`${expiresAt}.${disposition}.${sig}`).toString('base64url')
}

export function verifyLocalToken(key: string, token: string): boolean {
  try {
    const [expStr, disposition, sig] = Buffer.from(token, 'base64url').toString().split('.')
    const expiresAt = Number(expStr)
    if (!expiresAt || Date.now() > expiresAt) return false
    const expected = createHmac('sha256', SECRET).update(`${key}|${expiresAt}|${disposition}`).digest('hex').slice(0, 32)
    const a = Buffer.from(sig ?? '')
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local' as const

  // Upload "URL" is our own PUT route; the admin client PUTs bytes there and we write to disk.
  async signUpload(key: string): Promise<string> {
    const token = signLocalToken(key, Date.now() + 15 * 60 * 1000, 'put')
    return `/api/vault/local/${encodeURI(key)}?t=${token}`
  }

  async signDownload(key: string, opts: SignedGetOptions = {}): Promise<string> {
    const ttl = (opts.ttlSeconds ?? 90) * 1000
    const token = signLocalToken(key, Date.now() + ttl, opts.disposition ?? 'inline')
    return `/api/vault/local/${encodeURI(key)}?t=${token}`
  }

  async delete(key: string): Promise<void> {
    await fs.rm(diskPath(key), { force: true })
  }

  async size(key: string): Promise<number> {
    try {
      return (await fs.stat(diskPath(key))).size
    } catch {
      return 0
    }
  }

  async move(from: string, to: string): Promise<void> {
    const dest = diskPath(to)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.rename(diskPath(from), dest)
  }

  async writeLocal(key: string, body: Buffer): Promise<void> {
    const p = diskPath(key)
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, body)
  }

  async readLocal(key: string): Promise<Buffer> {
    return fs.readFile(diskPath(key))
  }

  /** Leading bytes only (content sniff) without loading a multi-GB file. */
  async readHead(key: string, n: number): Promise<Buffer> {
    const fh = await fs.open(diskPath(key), 'r')
    try {
      const buf = Buffer.alloc(n)
      const { bytesRead } = await fh.read(buf, 0, n, 0)
      return buf.subarray(0, bytesRead)
    } finally {
      await fh.close()
    }
  }

  newFileId(): string {
    return randomUUID()
  }
}
