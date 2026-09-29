import { Queue, Worker, QueueEvents, type JobsOptions } from 'bullmq'
import IORedis from 'ioredis'
import { CONFIG } from './config'

// Durable job queue so an admin request is never lost: every chat/embed/vision call is
// enqueued to Redis (AOF-persisted) before any model work. A job survives an Ollama pod
// restart (rescheduled) and a gateway pod restart (another replica's Worker drains it).
// The HTTP handler waits for the job's result via QueueEvents, so callers stay synchronous.
// Repeated failures land in a dead-letter set (attempts exhausted) and the caller gets a
// clean error rather than a hang.

export const QUEUE_NAME = 'ai-jobs'

const connection = new IORedis(CONFIG.redisUrl, { maxRetriesPerRequest: null })

export const queue = new Queue(QUEUE_NAME, { connection })
const events = new QueueEvents(QUEUE_NAME, { connection })

const DEFAULT_OPTS: JobsOptions = {
  attempts: Number(process.env.AI_JOB_ATTEMPTS) || 3,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86_400 },
}

export type JobKind = 'chat' | 'embed' | 'vision'
export interface JobData { kind: JobKind; payload: unknown }

/**
 * Enqueue a job and resolve with its result when the worker finishes. Rejects if the job
 * exhausts its retries (moved to failed) — never hangs past the job's own lifecycle.
 */
export async function runJob<T>(data: JobData): Promise<T> {
  const job = await queue.add(data.kind, data, DEFAULT_OPTS)
  const result = await job.waitUntilFinished(events)
  return result as T
}

/** Register the processor. The gateway starts one Worker per replica; scale via replicas. */
export function startWorker(process_: (data: JobData) => Promise<unknown>): Worker {
  return new Worker(
    QUEUE_NAME,
    async (job) => process_(job.data as JobData),
    { connection, concurrency: Number(process.env.AI_WORKER_CONCURRENCY) || 2 },
  )
}

export async function queueHealth(): Promise<boolean> {
  try {
    await connection.ping()
    return true
  } catch {
    return false
  }
}
