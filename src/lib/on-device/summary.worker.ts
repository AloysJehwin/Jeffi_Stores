/// <reference lib="webworker" />
/**
 * Web Worker that runs the on-device Gemma 3 270M recap model via transformers.js
 * (WebGPU). Kept OFF the main thread so checkout never janks during model load or
 * generation.
 *
 * Protocol (main → worker):
 *   { type: 'load' }
 *   { type: 'generate', id, prompt }
 * Worker → main:
 *   { type: 'ready' } | { type: 'load-error', error }
 *   { type: 'result', id, text } | { type: 'error', id, error }
 */
import {
  AutoTokenizer,
  AutoModelForCausalLM,
  TextStreamer,
  env,
} from '@huggingface/transformers'

// Self-host the model on OUR origin, presented to transformers.js as its "hub".
// We deliberately use the remote code path (remoteHost + remotePathTemplate)
// rather than localModelPath, because:
//   1. localModelPath's existence probe treats an absolute URL as "remote" and
//      fails to find files (returns empty tokenizer set → crash), and
//   2. a blob-based Worker resolves root-relative URLs against its blob: URL,
//      which also breaks fetching.
// Pointing remoteHost at our own origin does plain GETs against
// <origin>/models/<id>/<file>, which works in the worker.
const ORIGIN = (self as any).location?.origin || ''
env.allowRemoteModels = true
env.allowLocalModels = false
;(env as any).remoteHost = ORIGIN
;(env as any).remotePathTemplate = '/models/{model}'

// Serve the onnxruntime-web WASM/backend files from our own origin (public/ort/)
// instead of the jsdelivr CDN — the CDN is blocked by our CSP and we don't want
// a third-party runtime dependency. Files copied from node_modules/onnxruntime-web/dist.
try {
  ;(env as any).backends.onnx.wasm.wasmPaths = `${ORIGIN}/ort/`
} catch { /* backends not ready — set below after first import */ }

const MODEL_ID = 'onboarding'

let tokenizer: any = null
let model: any = null
let loading: Promise<void> | null = null

async function load() {
  if (loading) return loading
  loading = (async () => {
    tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID)
    model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
      // Quantized weights (model_quantized.onnx) + WebGPU acceleration.
      dtype: 'q8',
      device: 'webgpu',
    })
  })()
  return loading
}

async function generate(id: number, prompt: string) {
  await load()
  const inputs = await tokenizer(prompt)
  const promptLen: number = inputs.input_ids.dims.at(-1)

  // Stream tokens back so the UI can show text as it arrives.
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      ;(self as any).postMessage({ type: 'token', id, text })
    },
  })

  // generate() returns a 2-D Tensor [batch, seq]. Convert to a JS array and
  // drop the prompt tokens, then decode just the newly generated ids.
  const output = await model.generate({
    ...inputs,
    max_new_tokens: 90,
    do_sample: false,
    streamer,
  })

  const seq: number[] = Array.from(output.tolist ? output.tolist()[0] : output[0])
  const newIds = seq.slice(promptLen)
  const decoded: string = tokenizer.decode(newIds, { skip_special_tokens: true })
  ;(self as any).postMessage({ type: 'result', id, text: decoded.trim() })
}

self.addEventListener('message', async (e: MessageEvent) => {
  const msg = e.data
  try {
    if (msg.type === 'load') {
      await load()
      ;(self as any).postMessage({ type: 'ready' })
    } else if (msg.type === 'generate') {
      await generate(msg.id, msg.prompt)
    }
  } catch (err: any) {
    const error = err?.message || String(err)
    if (msg.type === 'load') (self as any).postMessage({ type: 'load-error', error })
    else (self as any).postMessage({ type: 'error', id: msg.id, error })
  }
})
