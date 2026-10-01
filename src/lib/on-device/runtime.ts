/**
 * Main-thread interface to the on-device recap model worker.
 *
 * Lazy + idempotent: the worker (and the ~400MB model download) is only created
 * on the first generateRecap() call, and only when the capability gate passes.
 * All work happens in the Web Worker so the checkout thread never blocks.
 */
import { detectOnDeviceCapability } from './capability'
import {
  buildRecapPrompt,
  buildCartInsightPrompt,
  buildProductPitchPrompt,
  buildAffirmationPrompt,
  type SessionSignals,
} from './prompt'
import type { UserProfile } from './user-profile'

let worker: Worker | null = null
let workerMobile = false
let nextId = 1
let lastError: string | null = null
type Pending = {
  resolve: (s: string) => void
  reject: (e: Error) => void
  onToken?: (partial: string) => void
  acc: string
}
const pending = new Map<number, Pending>()

export function getLastOnDeviceError(): string | null {
  return lastError
}

// Strip repetition loops — e.g. "Build Your Quality Build Your Quality..."
function deloop(text: string): string {
  const words = text.trim().split(/\s+/)
  // Try window sizes 2–6 words; find the first repeating sequence
  for (let w = 2; w <= 6; w++) {
    for (let i = 0; i + w * 2 <= words.length; i++) {
      const chunk = words.slice(i, i + w).join(' ')
      const rest = words.slice(i + w).join(' ')
      if (rest.startsWith(chunk)) {
        // Repetition found — keep text up to first occurrence
        return words.slice(0, i + w).join(' ')
      }
    }
  }
  return text
}

function ensureWorker(isMobile: boolean): Worker {
  if (worker) return worker
  workerMobile = isMobile
  worker = new Worker(new URL('./summary.worker.ts', import.meta.url), { type: 'module' })
  // Send mobile flag before any generate request
  worker.postMessage({ type: 'init', isMobile })
  const failAll = (err: string) => {
    lastError = err
    for (const [id, p] of pending) {
      pending.delete(id)
      p.reject(new Error(err))
    }
  }
  worker.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data
    if (msg.type === 'token' && pending.has(msg.id)) {
      const p = pending.get(msg.id)!
      p.acc += msg.text
      p.onToken?.(deloop(p.acc))
    } else if (msg.type === 'result' && pending.has(msg.id)) {
      const p = pending.get(msg.id)!
      pending.delete(msg.id)
      p.resolve(deloop(msg.text || p.acc))
    } else if (msg.type === 'error' && pending.has(msg.id)) {
      const p = pending.get(msg.id)!
      pending.delete(msg.id)
      p.reject(new Error(msg.error))
    } else if (msg.type === 'load-error') {
      failAll(msg.error || 'model load failed')
    }
  })
  worker.addEventListener('error', e => failAll(e.message || 'worker crashed'))
  worker.addEventListener('messageerror', () => failAll('worker message error'))
  return worker
}

export async function canRunOnDeviceSummary(): Promise<{ capable: boolean; reason: string; isMobile: boolean }> {
  const v = await detectOnDeviceCapability()
  return { capable: v.capable, reason: v.reason, isMobile: v.details.isMobile }
}

export function generateRecap(
  signals: SessionSignals,
  isMobile: boolean,
  onToken?: (partial: string) => void
): Promise<string> {
  const w = ensureWorker(isMobile)
  const id = nextId++
  const prompt = buildRecapPrompt(signals)
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject, onToken, acc: '' })
    w.postMessage({ type: 'generate', id, prompt })
  })
}

function runPrompt(prompt: string, isMobile: boolean, onToken?: (partial: string) => void): Promise<string> {
  const w = ensureWorker(isMobile)
  const id = nextId++
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject, onToken, acc: '' })
    w.postMessage({ type: 'generate', id, prompt })
  })
}

export function generateCartInsight(
  signals: SessionSignals,
  isMobile: boolean,
  onToken?: (partial: string) => void
): Promise<string> {
  return runPrompt(buildCartInsightPrompt(signals), isMobile, onToken)
}

export function generateProductPitch(
  productName: string,
  brand: string | null,
  category: string | null,
  profile: UserProfile | null,
  isMobile: boolean,
  onToken?: (partial: string) => void
): Promise<string> {
  return runPrompt(buildProductPitchPrompt(productName, brand, category, profile), isMobile, onToken)
}

export function generateAffirmation(
  itemNames: string[],
  total: number,
  profile: UserProfile | null,
  isMobile: boolean,
  onToken?: (partial: string) => void
): Promise<string> {
  return runPrompt(buildAffirmationPrompt(itemNames, total, profile), isMobile, onToken)
}

export function disposeSummarizer() {
  if (worker) {
    worker.terminate()
    worker = null
  }
  pending.clear()
}

/**
 * Fire-and-forget on-device LoRA fine-tuning. Spawns the fine-tune worker ONLY
 * when the DB feature flag is on AND the device is capable. Best-effort: any
 * failure is swallowed. The worker self-terminates after one pass.
 *
 *   enabled — useStoreConfig().flags.ondeviceFinetuneEnabled (DB-backed)
 *   examples — recent {prompt, completion, feedback} training examples
 */
export async function maybeRunFineTune(
  enabled: boolean,
  examples: import('./fine-tune.worker').FineTuneExample[]
): Promise<void> {
  try {
    if (!enabled) return
    if (typeof window === 'undefined' || typeof Worker === 'undefined') return
    if (!examples || examples.length === 0) return
    const { capable } = await canRunOnDeviceSummary()
    if (!capable) return

    const ftWorker = new Worker(new URL('./fine-tune.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => {
      try {
        ftWorker.terminate()
      } catch {}
    }
    ftWorker.addEventListener('message', (e: MessageEvent) => {
      const msg = e.data
      if (msg?.type === 'finetune-done' || msg?.type === 'finetune-error') cleanup()
    })
    ftWorker.addEventListener('error', cleanup)
    ftWorker.addEventListener('messageerror', cleanup)
    ftWorker.postMessage({ type: 'finetune', examples })
  } catch {
    // best-effort — never surface fine-tune failures to the user
  }
}
