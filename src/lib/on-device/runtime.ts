/**
 * Main-thread interface to the on-device recap model worker.
 *
 * Lazy + idempotent: the worker (and the ~400MB model download) is only created
 * on the first generateRecap() call, and only when the capability gate passes.
 * All work happens in the Web Worker so the checkout thread never blocks.
 */
import { detectOnDeviceCapability } from './capability'
import { buildRecapPrompt, type SessionSignals } from './prompt'

let worker: Worker | null = null
let nextId = 1
type Pending = { resolve: (s: string) => void; reject: (e: Error) => void; onToken?: (partial: string) => void; acc: string }
const pending = new Map<number, Pending>()

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./summary.worker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data
    if (msg.type === 'token' && pending.has(msg.id)) {
      const p = pending.get(msg.id)!
      p.acc += msg.text
      p.onToken?.(p.acc)
    } else if (msg.type === 'result' && pending.has(msg.id)) {
      const p = pending.get(msg.id)!
      pending.delete(msg.id)
      p.resolve(msg.text || p.acc)
    } else if (msg.type === 'error' && pending.has(msg.id)) {
      const p = pending.get(msg.id)!
      pending.delete(msg.id)
      p.reject(new Error(msg.error))
    }
  })
  return worker
}

/** Is the on-device summary usable on this device right now? (flag + WebGPU + memory). */
export async function canRunOnDeviceSummary(): Promise<boolean> {
  const v = await detectOnDeviceCapability()
  return v.capable
}

/**
 * Generate a recap for the given signals. Resolves with the final text; calls
 * onToken with the accumulating partial as tokens stream in. Rejects on any
 * failure (caller should treat the summary as simply unavailable).
 */
export function generateRecap(
  signals: SessionSignals,
  onToken?: (partial: string) => void
): Promise<string> {
  const w = ensureWorker()
  const id = nextId++
  const prompt = buildRecapPrompt(signals)
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject, onToken, acc: '' })
    w.postMessage({ type: 'generate', id, prompt })
  })
}

/** Free the worker + model (e.g. on unmount / navigation away from checkout). */
export function disposeSummarizer() {
  if (worker) { worker.terminate(); worker = null }
  pending.clear()
}
