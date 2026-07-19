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

// Serve our self-hosted model from /models/onboarding (public/). Disable the
// remote HF hub so nothing is fetched from the internet.
env.allowRemoteModels = false
env.allowLocalModels = true
// Model files live under public/models/ ; transformers.js prepends this base.
;(env as any).localModelPath = '/models/'

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
  const inputs = await tokenizer(prompt, { return_tensor: true })

  // Stream tokens back so the UI can show text as it arrives.
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      ;(self as any).postMessage({ type: 'token', id, text })
    },
  })

  const output = await model.generate({
    ...inputs,
    max_new_tokens: 90,
    do_sample: false,
    streamer,
  })

  const decoded: string = tokenizer.decode(
    output[0].slice(inputs.input_ids.dims.at(-1)),
    { skip_special_tokens: true }
  )
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
