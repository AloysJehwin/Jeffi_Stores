// Short-lived blob store for generated images and videos. Redis when configured, otherwise
// an in-process LRU; either way objects age out and the app persists to S3 before TTL expires.

import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'

export interface FileRecord { bytes: Buffer; mime: string }

const DEFAULT_TTL_SECONDS = Number(process.env.AI_FILES_TTL_SECONDS) || 3600

export interface FileStore {
  put(rec: FileRecord, ttlSec?: number): Promise<string>
  get(id: string): Promise<FileRecord | null>
}

class MemoryFileStore implements FileStore {
  private readonly entries = new Map<string, { rec: FileRecord; expiresAt: number }>()
  private readonly maxBytes = Number(process.env.AI_FILES_MAX_BYTES) || 512 * 1024 * 1024
  private used = 0

  async put(rec: FileRecord, ttlSec = DEFAULT_TTL_SECONDS): Promise<string> {
    this.gc()
    while (this.used + rec.bytes.length > this.maxBytes) {
      const oldest = this.entries.keys().next().value
      if (!oldest) break
      this.drop(oldest)
    }
    const id = randomUUID()
    this.entries.set(id, { rec, expiresAt: Date.now() + ttlSec * 1000 })
    this.used += rec.bytes.length
    return id
  }

  async get(id: string): Promise<FileRecord | null> {
    const row = this.entries.get(id)
    if (!row) return null
    if (row.expiresAt < Date.now()) { this.drop(id); return null }
    return row.rec
  }

  private drop(id: string): void {
    const row = this.entries.get(id)
    if (!row) return
    this.used -= row.rec.bytes.length
    this.entries.delete(id)
  }

  private gc(): void {
    const now = Date.now()
    for (const [id, row] of this.entries) if (row.expiresAt < now) this.drop(id)
  }
}

class RedisFileStore implements FileStore {
  constructor(private readonly redis: Redis) {}
  async put(rec: FileRecord, ttlSec = DEFAULT_TTL_SECONDS): Promise<string> {
    const id = randomUUID()
    const key = `ai:files:${id}`
    await this.redis.set(`${key}:mime`, rec.mime, 'EX', ttlSec)
    await this.redis.set(key, rec.bytes as unknown as string, 'EX', ttlSec)
    return id
  }
  async get(id: string): Promise<FileRecord | null> {
    const key = `ai:files:${id}`
    const [mime, bytes] = await Promise.all([
      this.redis.get(`${key}:mime`),
      this.redis.getBuffer(key),
    ])
    if (!mime || !bytes) return null
    return { mime, bytes }
  }
}

export function createFileStore(redis?: Redis | null): FileStore {
  return redis ? new RedisFileStore(redis) : new MemoryFileStore()
}

export const FILES_TTL_SECONDS = DEFAULT_TTL_SECONDS
