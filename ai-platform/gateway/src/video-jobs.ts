// Persistent video-job state: provider op id, status timeline, final usage.
// Keys ai:video:<jobId> with a 24 h TTL; the gateway polls them on a timer and in GET /v1/jobs.

import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import type { VideoAspect, VideoJobResponse, VideoJobStatus, VideoProviderName, VideoUsage } from '../../sdk/types'
import type { VideoResult } from './providers/types'

const KEY = (id: string) => `ai:video:${id}`
const TTL_SECONDS = Number(process.env.AI_VIDEO_TTL_SECONDS) || 86_400

export interface VideoJobState {
  jobId: string
  provider: VideoProviderName
  model: string
  opId: string
  status: VideoJobStatus
  durationSec: number
  aspect: VideoAspect
  namespace?: string
  prompt: string
  imageUrl?: string
  startedAt: number
  updatedAt: number
  result?: { fileId: string; mime: string; width: number; height: number; durationSec: number }
  usage?: VideoUsage
  error?: string
}

export interface VideoJobStore {
  create(input: Omit<VideoJobState, 'jobId' | 'status' | 'startedAt' | 'updatedAt'>): Promise<VideoJobState>
  get(id: string): Promise<VideoJobState | null>
  update(id: string, patch: Partial<VideoJobState>): Promise<VideoJobState | null>
  listOpen(limit?: number): Promise<VideoJobState[]>
}

class RedisVideoJobStore implements VideoJobStore {
  constructor(private readonly redis: Redis) {}

  async create(input: Omit<VideoJobState, 'jobId' | 'status' | 'startedAt' | 'updatedAt'>): Promise<VideoJobState> {
    const now = Date.now()
    const state: VideoJobState = { jobId: randomUUID(), status: 'queued', startedAt: now, updatedAt: now, ...input }
    await this.write(state)
    await this.redis.sadd('ai:video:open', state.jobId).catch(() => undefined)
    return state
  }

  async get(id: string): Promise<VideoJobState | null> {
    const raw = await this.redis.get(KEY(id)).catch(() => null)
    if (!raw) return null
    try { return JSON.parse(raw) as VideoJobState } catch { return null }
  }

  async update(id: string, patch: Partial<VideoJobState>): Promise<VideoJobState | null> {
    const cur = await this.get(id)
    if (!cur) return null
    const next: VideoJobState = { ...cur, ...patch, updatedAt: Date.now() }
    await this.write(next)
    if (next.status === 'done' || next.status === 'failed') {
      await this.redis.srem('ai:video:open', id).catch(() => undefined)
    }
    return next
  }

  async listOpen(limit = 50): Promise<VideoJobState[]> {
    const ids = await this.redis.smembers('ai:video:open').catch(() => [] as string[])
    const take = ids.slice(0, limit)
    const out: VideoJobState[] = []
    for (const id of take) {
      const s = await this.get(id)
      if (!s) { await this.redis.srem('ai:video:open', id).catch(() => undefined); continue }
      if (s.status === 'queued' || s.status === 'running') out.push(s)
    }
    return out
  }

  private async write(state: VideoJobState): Promise<void> {
    await this.redis.set(KEY(state.jobId), JSON.stringify(state), 'EX', TTL_SECONDS)
  }
}

class MemoryVideoJobStore implements VideoJobStore {
  private readonly rows = new Map<string, VideoJobState>()
  async create(input: Omit<VideoJobState, 'jobId' | 'status' | 'startedAt' | 'updatedAt'>): Promise<VideoJobState> {
    const now = Date.now()
    const state: VideoJobState = { jobId: randomUUID(), status: 'queued', startedAt: now, updatedAt: now, ...input }
    this.rows.set(state.jobId, state)
    return state
  }
  async get(id: string): Promise<VideoJobState | null> { return this.rows.get(id) ?? null }
  async update(id: string, patch: Partial<VideoJobState>): Promise<VideoJobState | null> {
    const cur = this.rows.get(id); if (!cur) return null
    const next: VideoJobState = { ...cur, ...patch, updatedAt: Date.now() }
    this.rows.set(id, next); return next
  }
  async listOpen(): Promise<VideoJobState[]> {
    return [...this.rows.values()].filter(s => s.status === 'queued' || s.status === 'running')
  }
}

export function createVideoJobStore(redis?: Redis | null): VideoJobStore {
  return redis ? new RedisVideoJobStore(redis) : new MemoryVideoJobStore()
}

export function toResponse(state: VideoJobState, fileBaseUrl = ''): VideoJobResponse {
  const base: VideoJobResponse = { status: state.status, provider: state.provider, model: state.model }
  if (state.error) base.error = state.error
  if (state.result) {
    base.result = {
      videoUrl: `${fileBaseUrl}/v1/files/${state.result.fileId}`,
      mime: state.result.mime,
      width: state.result.width,
      height: state.result.height,
      durationSec: state.result.durationSec,
    }
  }
  if (state.usage) base.usage = state.usage
  return base
}

export function resultFrom(r: VideoResult, fileId: string, fallbackDurationSec: number, aspect: VideoAspect): VideoJobState['result'] {
  const durationSec = r.durationSec || fallbackDurationSec
  let { width, height } = r
  if (!width || !height) {
    // Fall back to the aspect/resolution we asked the provider for.
    if (aspect === '9:16') { width = 720; height = 1280 }
    else if (aspect === '1:1') { width = 720; height = 720 }
    else { width = 1280; height = 720 }
  }
  return { fileId, mime: r.mime || 'video/mp4', width, height, durationSec }
}

export const VIDEO_TTL_SECONDS = TTL_SECONDS
