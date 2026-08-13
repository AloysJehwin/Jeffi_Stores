/// <reference lib="webworker" />
/**
 * On-device LoRA fine-tuning worker.
 * Runs micro gradient steps in the background after a successful order,
 * adapting the recap model towards the user's style preferences.
 *
 * NOTE: This worker is not currently instantiated anywhere (no `new Worker(...)`
 * spawn path exists), so the DB flag `feature_ondevice_finetune_enabled`
 * (useStoreConfig().flags.ondeviceFinetuneEnabled) is inert until a spawner is
 * wired. When wiring one, gate the spawn on that DB flag and pass it into the
 * worker's init message rather than relying on the build-time env read below.
 *
 * Saves LoRA weights to IndexedDB key 'jeffi_lora_v1'.
 *
 * Protocol (main → worker):
 *   { type: 'finetune', examples: FineTuneExample[] }
 * Worker → main:
 *   { type: 'finetune-done', steps: number }
 *   { type: 'finetune-error', error: string }
 */

export interface FineTuneExample {
  prompt: string
  completion: string
  feedback?: 'liked' | 'disliked'
}

const LORA_DB_NAME = 'jeffi-ondevice'
const LORA_STORE = 'lora-weights'
const LORA_KEY = 'jeffi_lora_v1'
const FINETUNE_STEPS = 3

async function openLoraDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LORA_DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(LORA_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveLoraWeights(weights: ArrayBuffer): Promise<void> {
  const db = await openLoraDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LORA_STORE, 'readwrite')
    tx.objectStore(LORA_STORE).put(weights, LORA_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function loadLoraWeights(): Promise<ArrayBuffer | null> {
  try {
    const db = await openLoraDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LORA_STORE, 'readonly')
      const req = tx.objectStore(LORA_STORE).get(LORA_KEY)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  } catch { return null }
}

async function runFineTune(examples: FineTuneExample[]): Promise<number> {
  // Gating (DB feature flag + device capability) is decided on the main thread
  // before this worker is ever spawned — see maybeRunFineTune() in runtime.ts.
  if (!examples.length) return 0

  // Filter to liked examples only (or all if no feedback yet)
  const trainingExamples = examples.filter(e => e.feedback !== 'disliked')
  if (!trainingExamples.length) return 0

  // Dynamically import transformers only when needed
  const { AutoTokenizer, AutoModelForCausalLM, env } = await import('@huggingface/transformers')

  const ORIGIN = (self as any).location?.origin || ''
  const RAW_BASE = process.env.NEXT_PUBLIC_ONDEVICE_MODEL_BASE || `${ORIGIN}/models/onboarding`
  const MODEL_BASE = RAW_BASE.replace(/\/+$/, '')
  const MODEL_ID = 'onboarding'

  env.allowRemoteModels = true
  env.allowLocalModels = false
  const baseUrl = new URL(MODEL_BASE)
  const basePath = baseUrl.pathname.replace(/\/+$/, '')
  const templatePath = basePath.includes(`/${MODEL_ID}`)
    ? basePath.replace(`/${MODEL_ID}`, `/{model}`)
    : `${basePath}/{model}`
  ;(env as any).remoteHost = baseUrl.origin
  ;(env as any).remotePathTemplate = templatePath
  try { ;(env as any).backends.onnx.wasm.wasmPaths = `${MODEL_BASE}/ort/` } catch {}

  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID)
  const model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
    dtype: 'q4',
    device: 'webgpu',
  })

  // Load existing LoRA weights if any
  const existingWeights = await loadLoraWeights()
  if (existingWeights && (model as any).load_lora_weights) {
    try { await (model as any).load_lora_weights(existingWeights) } catch {}
  }

  let stepsRun = 0

  // Micro gradient steps — 1–3 passes over training examples
  for (let step = 0; step < FINETUNE_STEPS; step++) {
    for (const ex of trainingExamples.slice(0, 5)) {
      try {
        const fullText = `${ex.prompt}\n${ex.completion}`
        const inputs = await tokenizer(fullText, { return_tensors: 'pt' } as any)
        if ((model as any).train_step) {
          await (model as any).train_step(inputs)
          stepsRun++
        }
      } catch { /* skip failed examples */ }
    }
  }

  // Save updated LoRA weights if the model exposes them
  try {
    if ((model as any).get_lora_weights) {
      const weights: ArrayBuffer = await (model as any).get_lora_weights()
      if (weights) await saveLoraWeights(weights)
    }
  } catch {}

  return stepsRun
}

self.addEventListener('message', async (e: MessageEvent) => {
  const msg = e.data
  if (msg.type === 'finetune') {
    try {
      const steps = await runFineTune(msg.examples || [])
      ;(self as any).postMessage({ type: 'finetune-done', steps })
    } catch (err: any) {
      ;(self as any).postMessage({ type: 'finetune-error', error: err?.message || String(err) })
    }
  }
})
