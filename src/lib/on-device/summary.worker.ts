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

// The model + ORT runtime are served either from our own origin (local dev) or
// a CDN (prod), selected by NEXT_PUBLIC_ONDEVICE_MODEL_BASE. We present the host
// to transformers.js via the remote code path (remoteHost + remotePathTemplate)
// rather than localModelPath, because:
//   1. localModelPath's existence probe treats an absolute URL as "remote" and
//      fails to find files (empty tokenizer set → crash), and
//   2. a blob-based Worker resolves root-relative URLs against its blob: URL.
// Plain GETs against <host>/<template> work in the worker.
//
// Layout served (both origin/public and CDN):
//   <base>/models/onboarding[/vN]/config.json, tokenizer.json, onnx/*, ort/*
const ORIGIN = (self as any).location?.origin || ''
// NEXT_PUBLIC_ONDEVICE_MODEL_BASE = full URL to the model directory, e.g.
//   https://dm9rri2wgl1e.cloudfront.net/models/onboarding/v1
// When unset (local dev): same-origin /models/onboarding
const RAW_BASE = process.env.NEXT_PUBLIC_ONDEVICE_MODEL_BASE || `${ORIGIN}/models/onboarding`
const MODEL_BASE = RAW_BASE.replace(/\/+$/, '')

const MODEL_ID = 'onboarding'

env.allowRemoteModels = true
env.allowLocalModels = false
// transformers.js builds <remoteHost><remotePathTemplate-with-{model}>/<file>.
// Put the whole base path in the template with {model} standing in for the dir
// name, so files resolve at <base>/<file>.
const baseUrl = new URL(MODEL_BASE)
const basePath = baseUrl.pathname.replace(/\/+$/, '')                 // e.g. /models/onboarding/v1
const templatePath = basePath.includes(`/${MODEL_ID}`)
  ? basePath.replace(`/${MODEL_ID}`, `/{model}`)                      // /models/{model}/v1
  : `${basePath}/{model}`                                            // fallback
;(env as any).remoteHost = baseUrl.origin
;(env as any).remotePathTemplate = templatePath

// onnxruntime-web WASM/backends under <base>/ort/ (not jsdelivr, which CSP blocks).
try {
  ;(env as any).backends.onnx.wasm.wasmPaths = `${MODEL_BASE}/ort/`
} catch { /* backends not ready — harmless */ }

let tokenizer: any = null
let model: any = null
let loading: Promise<void> | null = null
let isMobile = false

async function load() {
  if (loading) return loading
  loading = (async () => {
    tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID)
    model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
      // q4 on mobile — smaller memory footprint, faster on mobile GPU
      dtype: isMobile ? 'q4' : 'q8',
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
    if (msg.type === 'init') {
      isMobile = !!msg.isMobile
    } else if (msg.type === 'load') {
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
