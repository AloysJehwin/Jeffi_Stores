// One shared pair of QueueEvents listeners dispatching to per-job waiters.
//
// BullMQ's job.waitUntilFinished() adds a 'closing' listener to the Queue (plus two on
// QueueEvents) per call and only removes them when the job's completed/failed event arrives.
// With no ttl, a missed event or a job that outlives its caller leaks them forever
// (MaxListenersExceededWarning: N closing listeners added to [Queue]). Here listener count is
// constant and every waiter is removed on settle or timeout.

interface EventSource {
  on(event: 'completed', fn: (args: { jobId: string; returnvalue: unknown }) => void): unknown
  on(event: 'failed', fn: (args: { jobId: string; failedReason: string }) => void): unknown
}

/** Final state lookup, used once on timeout in case the finish event was missed. */
export type FinishedLookup = (jobId: string) => Promise<{ state: 'completed'; value: unknown } | { state: 'failed'; reason: string } | null>

interface Waiter {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

export class JobWaiters {
  private readonly waiters = new Map<string, Waiter>()

  constructor(events: EventSource, private readonly lookup: FinishedLookup) {
    events.on('completed', ({ jobId, returnvalue }) => this.settle(jobId, w => w.resolve(returnvalue)))
    events.on('failed', ({ jobId, failedReason }) => this.settle(jobId, w => w.reject(new Error(failedReason || 'job failed'))))
  }

  get size(): number {
    return this.waiters.size
  }

  /** Register BEFORE enqueueing the job so its finish event cannot be missed. */
  wait<T>(jobId: string, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => void this.expire(jobId, timeoutMs), timeoutMs)
      timer.unref?.()
      this.waiters.set(jobId, { resolve: resolve as (v: unknown) => void, reject, timer })
    })
  }

  /** Drop a waiter (e.g. enqueue failed). */
  cancel(jobId: string, err: Error): void {
    this.settle(jobId, w => w.reject(err))
  }

  private settle(jobId: string, fn: (w: Waiter) => void): void {
    const w = this.waiters.get(jobId)
    if (!w) return
    this.waiters.delete(jobId)
    clearTimeout(w.timer)
    fn(w)
  }

  private async expire(jobId: string, timeoutMs: number): Promise<void> {
    if (!this.waiters.has(jobId)) return
    const done = await this.lookup(jobId).catch(() => null)
    if (done?.state === 'completed') return this.settle(jobId, w => w.resolve(done.value))
    if (done?.state === 'failed') return this.settle(jobId, w => w.reject(new Error(done.reason)))
    this.settle(jobId, w => w.reject(new Error(`AI job ${jobId} did not finish within ${timeoutMs}ms`)))
  }
}
