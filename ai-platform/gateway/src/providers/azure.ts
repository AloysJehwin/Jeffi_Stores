// Azure, Microsoft-sold models only: every call names one of our own deployments from config, never a model id, so
// no Marketplace or partner model is reachable. Plain fetch, API key auth.
//   chat/vision  POST {endpoint}/openai/deployments/{chat}/chat/completions?api-version=   (stream: SSE + include_usage)
//   image        POST .../{image}/images/generations (b64_json); .../images/edits (multipart) with a reference image
//   embed        POST .../{embed}/embeddings { input[], dimensions: 768 }
//   stt          POST .../{transcribe}/audio/transcriptions (multipart); else Speech short audio (60 s, wav or ogg/opus)
//   tts          Speech POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1 (SSML, neural voices);
//                else POST .../{tts}/audio/speech
//   video        Sora 2 on the v1 API: POST {endpoint}/openai/v1/videos, GET .../videos/{id}, GET .../videos/{id}/content

import { CONFIG } from '../config'
import { options, type Capability, type ModelList } from '../models'
import { costFor, openAiUsage, tokenUsage } from '../pricing'
import type {
  AiChatMessage, AiChatRequest, AiChatStreamEvent, AiToolCall, TokenUsage, VisionRequest, VisionResponse,
} from '../../../sdk/types'
import {
  ProviderError, audioExt, loadImage, toImage,
  type AudioFormat, type AudioProvider, type ImageGenInput, type ImageGenOutput, type MediaProvider,
  type SpeakInput, type SpeakOutput, type TranscribeInput, type TranscribeOutput, type VideoGenInput, type VideoPoll, type VideoStart,
} from './types'

type DeploymentLists = 'chatDeployments' | 'imageDeployments' | 'embedDeployments' | 'transcribeDeployments' | 'ttsDeployments' | 'videoDeployments'
/** The lists are optional: without one a capability offers only its singular deployment. */
export type AzureConfig = Omit<typeof CONFIG.azure, DeploymentLists> & Partial<Pick<typeof CONFIG.azure, DeploymentLists>>

export const AZURE_EMBED_MODEL = 'text-embedding-3-small'
export const AZURE_EMBED_DIMENSIONS = 768
/** Vector-space id stored with azure vectors. */
export const AZURE_EMBED_MODEL_ID = `${AZURE_EMBED_MODEL}@${AZURE_EMBED_DIMENSIONS}`
export const SPEECH_STT_MODEL = 'azure-speech-stt'
export const SPEECH_TTS_MODEL = 'azure-speech-tts'

const EMBED_BATCH = 128
const JSON_ONLY = 'Respond with a single valid JSON value only: no prose, no markdown code fences.'
const OPENAI_VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'])
const MULTILINGUAL_VOICE = 'en-US-AvaMultilingualNeural'

/** Default neural voice per locale (female voices; any Speech voice name can be passed instead). */
export const DEFAULT_VOICES: Record<string, string> = {
  'en-IN': 'en-IN-NeerjaNeural',
  'hi-IN': 'hi-IN-SwaraNeural',
  'ta-IN': 'ta-IN-PallaviNeural',
  'te-IN': 'te-IN-ShrutiNeural',
  'kn-IN': 'kn-IN-SapnaNeural',
  'ml-IN': 'ml-IN-SobhanaNeural',
  'mr-IN': 'mr-IN-AarohiNeural',
  'bn-IN': 'bn-IN-TanishaaNeural',
  'gu-IN': 'gu-IN-DhwaniNeural',
  'pa-IN': 'pa-IN-VaaniNeural',
  'or-IN': 'or-IN-SubhasiniNeural',
  'ur-IN': 'ur-IN-GulNeural',
  'en-US': 'en-US-JennyNeural',
  'en-GB': 'en-GB-SoniaNeural',
}

/** A Speech voice name carries its locale (hi-IN-SwaraNeural); anything else (a Sarvam speaker) is not one. */
const SPEECH_VOICE = /^[a-z]{2,3}-[A-Za-z]{2,4}-\S+$/

/** Exact locale, else the language's Indian locale (hi → hi-IN), else a multilingual voice. */
export function defaultVoice(language: string): string {
  const [lang, region] = language.split('-')
  const locale = region ? `${lang.toLowerCase()}-${region.toUpperCase()}` : lang.toLowerCase()
  return DEFAULT_VOICES[locale] ?? DEFAULT_VOICES[`${lang.toLowerCase()}-IN`] ?? MULTILINGUAL_VOICE
}

const SPEECH_FORMATS: Record<AudioFormat, { header: string; mime: string }> = {
  mp3: { header: 'audio-24khz-48kbitrate-mono-mp3', mime: 'audio/mpeg' },
  wav: { header: 'riff-24khz-16bit-mono-pcm', mime: 'audio/wav' },
  ogg: { header: 'ogg-24khz-16bit-mono-opus', mime: 'audio/ogg' },
}
const OPENAI_TTS_FORMATS: Record<AudioFormat, { format: string; mime: string }> = {
  mp3: { format: 'mp3', mime: 'audio/mpeg' },
  wav: { format: 'wav', mime: 'audio/wav' },
  ogg: { format: 'opus', mime: 'audio/ogg' },
}
const QUALITY: Record<ImageGenInput['quality'], 'low' | 'medium' | 'high'> = { draft: 'low', standard: 'medium', premium: 'high' }
const SORA_SECONDS = [4, 8, 12] as const

export interface AzureChatResult {
  content: string
  toolCalls?: AiToolCall[]
  model: string
  usage: TokenUsage
  stopReason: string
}

interface ChatChoice {
  message?: { content?: string | null; tool_calls?: OpenAiToolCall[] }
  delta?: { content?: string | null; tool_calls?: (Partial<OpenAiToolCall> & { index?: number })[] }
  finish_reason?: string | null
}
interface OpenAiToolCall { id: string; type?: 'function'; function: { name: string; arguments: string } }
interface ChatResponse {
  model?: string
  choices?: ChatChoice[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
}
type OpenAiMessage =
  | { role: 'system' | 'user'; content: string | Record<string, unknown>[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

const STOP: Record<string, string> = { stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use', content_filter: 'refusal' }

/** Our Ollama-shaped messages as OpenAI chat messages; every tool call gets exactly one tool reply. */
export function toOpenAi(req: AiChatRequest): OpenAiMessage[] {
  const out: OpenAiMessage[] = []
  let pending: string[] = []
  let gen = 0
  const close = () => {
    for (const id of pending) out.push({ role: 'tool', tool_call_id: id, content: '(no result recorded)' })
    pending = []
  }
  for (const m of req.messages as AiChatMessage[]) {
    if (m.role === 'tool') {
      const id = m.tool_call_id && pending.includes(m.tool_call_id) ? m.tool_call_id : pending[0]
      if (id) {
        pending = pending.filter(p => p !== id)
        out.push({ role: 'tool', tool_call_id: id, content: m.content || '(empty)' })
      } else if (m.content) {
        out.push({ role: 'user', content: `Tool result:\n${m.content}` })
      }
      continue
    }
    close()
    if (m.role === 'assistant') {
      const calls: OpenAiToolCall[] = (m.tool_calls ?? []).map(tc => ({
        id: tc.id && /^[A-Za-z0-9_-]{1,64}$/.test(tc.id) ? tc.id : `call_gen_${gen++}`,
        type: 'function',
        function: { name: tc.function.name, arguments: JSON.stringify(tc.function.arguments ?? {}) },
      }))
      if (!m.content.trim() && !calls.length) continue
      out.push({ role: 'assistant', content: m.content || null, ...(calls.length ? { tool_calls: calls } : {}) })
      pending = calls.map(c => c.id)
      continue
    }
    if (m.content.trim()) out.push({ role: m.role, content: m.content })
  }
  close()
  if (req.jsonMode) out.push({ role: 'system', content: JSON_ONLY })
  return out
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch { return {} }
}

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
}

function imageMime(b64: string): string {
  if (b64.startsWith('/9j/')) return 'image/jpeg'
  if (b64.startsWith('R0lGOD')) return 'image/gif'
  if (b64.startsWith('UklGR')) return 'image/webp'
  return 'image/png'
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!))
}

/** Speech short audio takes only PCM WAV or Ogg Opus; null for anything else. */
export function speechContentType(mime: string, audio: Buffer): string | null {
  const m = mime.split(';')[0].trim().toLowerCase()
  if (m === 'audio/wav' || m === 'audio/x-wav' || m === 'audio/wave') {
    const rate = audio.length > 28 && audio.toString('ascii', 0, 4) === 'RIFF' ? audio.readUInt32LE(24) : 16000
    return `audio/wav; codecs=audio/pcm; samplerate=${rate || 16000}`
  }
  if (m === 'audio/ogg' || m === 'audio/opus') return 'audio/ogg; codecs=opus'
  return null
}

export class AzureProvider {
  constructor(private readonly cfg: AzureConfig = CONFIG.azure) {}

  private openai(deployment: string): boolean { return !!(this.cfg.endpoint && this.cfg.apiKey && deployment) }
  chatConfigured(): boolean { return this.openai(this.cfg.chatDeployment) }
  imageConfigured(): boolean { return this.openai(this.cfg.imageDeployment) }
  embedConfigured(): boolean { return this.openai(this.cfg.embedDeployment) }
  videoConfigured(): boolean { return this.openai(this.cfg.videoDeployment) }
  speechConfigured(): boolean { return !!(this.cfg.speechKey && this.cfg.speechRegion) }
  transcribeConfigured(): boolean { return this.openai(this.cfg.transcribeDeployment) || this.speechConfigured() }
  speakConfigured(): boolean { return this.speechConfigured() || this.openai(this.cfg.ttsDeployment) }
  /** Cache key model for chat answers: the request's deployment, else the default. */
  chatModel(choice?: string): string { return choice || this.cfg.chatDeployment }

  /** Deployments per capability (the default first); Speech is `azure-speech-stt` / `azure-speech-tts`. */
  models(cap: Capability): ModelList | null {
    const c = this.cfg
    const list = (one: string, more: string[] | undefined) => [one, ...(more ?? [])]
    switch (cap) {
      case 'text': return { models: options(list(c.chatDeployment, c.chatDeployments), c.chatDeployment) }
      case 'image': return { models: options(list(c.imageDeployment, c.imageDeployments), c.imageDeployment) }
      case 'video': return { models: options(list(c.videoDeployment, c.videoDeployments), c.videoDeployment) }
      case 'embed': {
        const ids = list(c.embedDeployment, c.embedDeployments).filter(Boolean)
        return { models: options(ids, c.embedDeployment), aliases: Object.fromEntries(ids.map(d => [this.embedModelId(d), d])) }
      }
      case 'stt': {
        const speech = this.speechConfigured() ? [SPEECH_STT_MODEL] : []
        const def = c.transcribeDeployment || speech[0]
        return { models: options([...list(c.transcribeDeployment, c.transcribeDeployments), ...speech], def), aliases: { 'azure-speech': SPEECH_STT_MODEL } }
      }
      case 'tts': {
        const speech = this.speechConfigured() ? [SPEECH_TTS_MODEL] : []
        const def = speech[0] || c.ttsDeployment
        return { models: options([...speech, ...list(c.ttsDeployment, c.ttsDeployments)], def), aliases: { 'azure-speech': SPEECH_TTS_MODEL } }
      }
    }
  }

  /** Vector-space id stored with vectors from an embeddings deployment. */
  embedModelId(deployment = this.cfg.embedDeployment): string {
    return deployment === this.cfg.embedDeployment ? AZURE_EMBED_MODEL_ID : `${deployment}@${AZURE_EMBED_DIMENSIONS}`
  }

  private url(deployment: string, op: string): string {
    return `${this.cfg.endpoint}/openai/deployments/${encodeURIComponent(deployment)}/${op}?api-version=${encodeURIComponent(this.cfg.apiVersion)}`
  }

  private async send(url: string, init: RequestInit, signal?: AbortSignal, timeoutMs = this.cfg.timeoutMs): Promise<Response> {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const onAbort = () => ctrl.abort()
    signal?.addEventListener('abort', onAbort)
    try {
      const headers = { 'api-key': this.cfg.apiKey, ...(init.headers as Record<string, string> | undefined) }
      const res = await fetch(url, { ...init, headers, signal: ctrl.signal })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new ProviderError('azure', `HTTP ${res.status} ${body.slice(0, 500)}`, res.status)
      }
      return res
    } catch (err) {
      if (err instanceof ProviderError) throw err
      const e = err as Error
      throw new ProviderError('azure', e?.name === 'AbortError' ? `timed out after ${Math.round(timeoutMs / 1000)}s` : e?.message || String(err))
    } finally {
      clearTimeout(t)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  private postJson(url: string, body: unknown, signal?: AbortSignal, timeoutMs?: number): Promise<Response> {
    return this.send(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, signal, timeoutMs)
  }

  /** Reasoning deployments reject a custom temperature: retry once without it. */
  private async postChat(body: Record<string, unknown>, signal?: AbortSignal, deployment = this.cfg.chatDeployment): Promise<Response> {
    const url = this.url(deployment, 'chat/completions')
    try {
      return await this.postJson(url, body, signal)
    } catch (err) {
      if (err instanceof ProviderError && err.status === 400 && 'temperature' in body && /temperature/i.test(err.message)) {
        const { temperature: _t, ...rest } = body
        return this.postJson(url, rest, signal)
      }
      throw err
    }
  }

  private assertChat(): void {
    if (!this.chatConfigured()) throw new ProviderError('azure', 'chat is not configured (AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_CHAT_DEPLOYMENT)')
  }

  /** One chat turn on the request's deployment (`models.azure`); streams text deltas and tool-call starts through `emit`. */
  async chat(req: AiChatRequest, emit?: (e: AiChatStreamEvent) => void, signal?: AbortSignal): Promise<AzureChatResult> {
    this.assertChat()
    const deployment = this.chatModel(req.models?.azure)
    const body: Record<string, unknown> = {
      messages: toOpenAi(req),
      max_completion_tokens: Math.max(req.maxTokens ?? 0, this.cfg.minMaxTokens),
      temperature: req.temperature ?? 0.2,
    }
    if (req.tools?.length) body.tools = req.tools
    if (!emit) return this.finish(await (await this.postChat(body, signal, deployment)).json() as ChatResponse, deployment, req.jsonMode)
    const res = await this.postChat({ ...body, stream: true, stream_options: { include_usage: true } }, signal, deployment)
    return this.finish(await readStream(res, emit), deployment, req.jsonMode)
  }

  private finish(r: ChatResponse, deployment: string, jsonMode?: boolean): AzureChatResult {
    const choice = r.choices?.[0]
    const model = r.model || deployment
    const finish = choice?.finish_reason ?? ''
    if (finish === 'content_filter' && !choice?.message?.content) throw new ProviderError('azure', 'blocked by the content filter')
    const calls = choice?.message?.tool_calls ?? []
    if (finish === 'length' && calls.length) throw new ProviderError('azure', 'tool input truncated by max tokens')
    let content = choice?.message?.content ?? ''
    if (jsonMode) content = stripFences(content)
    const toolCalls = calls.map(c => ({ id: c.id, name: c.function.name, arguments: parseArgs(c.function.arguments) }))
    return {
      content,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      model,
      usage: openAiUsage('azure', model, r.usage),
      stopReason: STOP[finish] ?? finish,
    }
  }

  /** Vision over base64 images with the chat deployment. Throws so the caller can fall back. */
  async vision(req: VisionRequest): Promise<VisionResponse> {
    this.assertChat()
    const deployment = this.chatModel(req.models?.azure)
    const content: Record<string, unknown>[] = [
      { type: 'text', text: req.prompt },
      ...req.images.map(b64 => ({ type: 'image_url', image_url: { url: `data:${imageMime(b64)};base64,${b64}` } })),
    ]
    const res = await this.postChat({
      messages: [{ role: 'user', content }],
      max_completion_tokens: Math.max(this.cfg.minMaxTokens, 4000),
      temperature: 0.1,
    }, undefined, deployment)
    const r = this.finish(await res.json() as ChatResponse, deployment)
    const text = r.content.trim()
    return { ok: !!text, text, model: r.model, provider: 'azure', pages: req.images.length, usage: r.usage }
  }

  /** 768 dimensions, so the vectors fit the existing vector(768) columns; `model` is the vector-space id. */
  async embed(input: string[], deployment?: string): Promise<{ embeddings: number[][]; promptTokens: number; usage: TokenUsage; model: string }> {
    if (!this.embedConfigured()) throw new ProviderError('azure', 'embeddings are not configured (AZURE_OPENAI_EMBED_DEPLOYMENT)')
    const d = deployment || this.cfg.embedDeployment
    const embeddings: number[][] = []
    let promptTokens = 0
    for (let i = 0; i < input.length; i += EMBED_BATCH) {
      const batch = input.slice(i, i + EMBED_BATCH)
      const res = await this.postJson(this.url(d, 'embeddings'), { input: batch, dimensions: AZURE_EMBED_DIMENSIONS })
      const r = await res.json() as { data?: { embedding?: number[]; index?: number }[]; usage?: { prompt_tokens?: number } }
      const rows = [...(r.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      if (rows.length !== batch.length) throw new ProviderError('azure', `embeddings returned ${rows.length} vectors for ${batch.length} inputs`)
      for (const row of rows) {
        if (!Array.isArray(row.embedding) || row.embedding.length !== AZURE_EMBED_DIMENSIONS) {
          throw new ProviderError('azure', `embedding has ${row.embedding?.length ?? 0} dimensions, expected ${AZURE_EMBED_DIMENSIONS}`)
        }
        embeddings.push(row.embedding)
      }
      promptTokens += Number(r.usage?.prompt_tokens) || 0
    }
    const priced = d === this.cfg.embedDeployment ? AZURE_EMBED_MODEL : d
    return { embeddings, promptTokens, usage: tokenUsage('azure', priced, promptTokens, 0), model: this.embedModelId(d) }
  }

  // ── Images (gpt-image) ──────────────────────────────────────────────────────
  async generateImage(req: ImageGenInput): Promise<ImageGenOutput> {
    if (!this.imageConfigured()) throw new ProviderError('azure', 'images are not configured (AZURE_OPENAI_IMAGE_DEPLOYMENT)')
    const model = req.model || this.cfg.imageDeployment
    const ratio = req.width / req.height
    const size = ratio > 1.2 ? '1536x1024' : ratio < 1 / 1.2 ? '1024x1536' : '1024x1024'
    const [w, h] = size.split('x').map(Number)
    const quality = QUALITY[req.quality] ?? 'medium'
    const prompt = req.negativePrompt ? `${req.prompt}\n\nAvoid: ${req.negativePrompt}` : req.prompt
    let res: Response
    if (req.referenceImageUrl) {
      const ref = await loadImage('azure', req.referenceImageUrl)
      const form = new FormData()
      form.append('image', new Blob([new Uint8Array(Buffer.from(ref.data, 'base64'))], { type: ref.mime }), `reference.${ref.mime.split('/')[1] || 'png'}`)
      form.append('prompt', prompt)
      form.append('n', String(req.n))
      form.append('size', size)
      form.append('quality', quality)
      res = await this.send(this.url(model, 'images/edits'), { method: 'POST', body: form })
    } else {
      res = await this.postJson(this.url(model, 'images/generations'), { prompt, n: req.n, size, quality, output_format: 'png' })
    }
    const r = await res.json() as { data?: { b64_json?: string }[] }
    const images = (r.data ?? []).filter(d => d.b64_json).slice(0, req.n)
      .map(d => toImage(Buffer.from(d.b64_json!, 'base64'), 'image/png', { width: w, height: h }))
    if (!images.length) throw new ProviderError('azure', 'no images returned')
    const costInr = costFor('azure', `${model}:${quality}`, { image: images.length }) * (size === '1024x1024' ? 1 : 1.5)
    return { images, model, costInr }
  }

  // ── Video (Sora 2) ──────────────────────────────────────────────────────────
  videoModel(req?: VideoGenInput): string { return req?.model || this.cfg.videoDeployment }

  async startVideo(req: VideoGenInput): Promise<VideoStart> {
    if (!this.videoConfigured()) throw new ProviderError('azure', 'video is not configured (AZURE_OPENAI_VIDEO_DEPLOYMENT)')
    // A reference image must match the output size exactly; the gateway does not resize, so text only.
    if (req.imageUrl) throw new ProviderError('azure', 'image-to-video is not supported on Azure')
    const aspect = req.aspect === '16:9' ? '16:9' : '9:16'
    const deployment = this.videoModel(req)
    const seconds = SORA_SECONDS.reduce((best, s) => (Math.abs(s - req.durationSec) < Math.abs(best - req.durationSec) ? s : best), SORA_SECONDS[0])
    const form = new FormData()
    form.append('model', deployment)
    form.append('prompt', req.prompt)
    form.append('size', aspect === '16:9' ? '1280x720' : '720x1280')
    form.append('seconds', String(seconds))
    const res = await this.send(`${this.cfg.endpoint}/openai/v1/videos`, { method: 'POST', body: form })
    const r = await res.json() as { id?: string }
    if (!r.id) throw new ProviderError('azure', 'video job returned no id')
    return { opId: r.id, model: deployment, durationSec: seconds, aspect }
  }

  async pollVideo(opId: string): Promise<VideoPoll> {
    const base = `${this.cfg.endpoint}/openai/v1/videos/${encodeURIComponent(opId)}`
    const r = await (await this.send(base, {}, undefined, 30_000)).json() as { status?: string; error?: { message?: string } | null }
    if (r.status === 'failed' || r.status === 'cancelled') return { done: true, error: r.error?.message || `video job ${r.status}` }
    if (r.status !== 'completed') return { done: false }
    const content = await this.send(`${base}/content`, {})
    const mime = (content.headers.get('content-type') || 'video/mp4').split(';')[0].trim()
    return { done: true, result: { bytes: Buffer.from(await content.arrayBuffer()), mime: mime.startsWith('video/') ? mime : 'video/mp4', width: 0, height: 0, durationSec: 0 } }
  }

  // ── Speech to text ──────────────────────────────────────────────────────────
  /** The request's model only (`azure-speech-stt` or a transcription deployment); else Azure OpenAI transcription
   *  when its deployment is set (Speech short audio after a failure), else Speech. */
  async transcribe(req: TranscribeInput): Promise<TranscribeOutput> {
    if (req.model === SPEECH_STT_MODEL) {
      if (!this.speechConfigured()) throw new ProviderError('azure', 'Azure Speech is not configured (AZURE_SPEECH_KEY)')
      return this.transcribeSpeech(req)
    }
    if (req.model) {
      if (!this.openai(req.model)) throw new ProviderError('azure', 'speech to text is not configured (AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY)')
      return this.transcribeOpenAi(req, req.model)
    }
    const speechOk = this.speechConfigured() && !!speechContentType(req.mimeType, req.audio)
    if (this.openai(this.cfg.transcribeDeployment)) {
      try {
        return await this.transcribeOpenAi(req)
      } catch (err) {
        if (!speechOk || (err instanceof ProviderError && err.status !== undefined && err.status < 500 && err.status !== 429)) throw err
      }
    }
    if (!this.speechConfigured()) throw new ProviderError('azure', 'speech to text is not configured (AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT or AZURE_SPEECH_KEY)')
    return this.transcribeSpeech(req)
  }

  private async transcribeOpenAi(req: TranscribeInput, deployment = this.cfg.transcribeDeployment): Promise<TranscribeOutput> {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(req.audio)], { type: req.mimeType.split(';')[0] }), `audio.${audioExt(req.mimeType)}`)
    form.append('response_format', 'json')
    if (req.language) form.append('language', req.language.split('-')[0].toLowerCase())
    const res = await this.send(this.url(deployment, 'audio/transcriptions'), { method: 'POST', body: form })
    const r = await res.json() as { text?: string; language?: string; duration?: number; usage?: { type?: string; seconds?: number } }
    const duration = typeof r.duration === 'number' ? r.duration : r.usage?.type === 'duration' ? r.usage.seconds : undefined
    return { text: (r.text ?? '').trim(), language: req.language ?? (r.language || undefined), durationSeconds: duration, model: deployment }
  }

  private async transcribeSpeech(req: TranscribeInput): Promise<TranscribeOutput> {
    const contentType = speechContentType(req.mimeType, req.audio)
    if (!contentType) throw new ProviderError('azure', 'Azure Speech short audio takes audio/wav or audio/ogg (opus); set AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT for other formats', 400)
    const language = req.language || 'en-IN'
    const url = `https://${this.cfg.speechRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(language)}&format=detailed`
    const res = await this.send(url, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': this.cfg.speechKey, 'Content-Type': contentType, Accept: 'application/json' },
      body: new Uint8Array(req.audio),
    })
    const r = await res.json() as { RecognitionStatus?: string; DisplayText?: string; NBest?: { Display?: string }[] }
    if (r.RecognitionStatus === 'NoMatch' || r.RecognitionStatus === 'InitialSilenceTimeout') return { text: '', language, model: SPEECH_STT_MODEL }
    if (r.RecognitionStatus !== 'Success') throw new ProviderError('azure', `speech recognition ${r.RecognitionStatus || 'failed'}`)
    return { text: (r.DisplayText ?? r.NBest?.[0]?.Display ?? '').trim(), language, model: SPEECH_STT_MODEL }
  }

  // ── Text to speech ──────────────────────────────────────────────────────────
  /** The request's model only (`azure-speech-tts` or a TTS deployment); else Speech neural voices first (Indian
   *  languages), the OpenAI TTS deployment for an OpenAI voice name or as the fallback. */
  async speak(req: SpeakInput): Promise<SpeakOutput> {
    const openaiVoice = !!req.voice && OPENAI_VOICES.has(req.voice.toLowerCase())
    const speechVoice = req.voice && SPEECH_VOICE.test(req.voice) ? req.voice : undefined
    if (req.model === SPEECH_TTS_MODEL) {
      if (!this.speechConfigured()) throw new ProviderError('azure', 'Azure Speech is not configured (AZURE_SPEECH_KEY)')
      return this.speakSpeech(req, speechVoice)
    }
    if (req.model) {
      if (!this.openai(req.model)) throw new ProviderError('azure', 'text to speech is not configured (AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY)')
      return this.speakOpenAi(req, openaiVoice ? req.voice : undefined, req.model)
    }
    const ways: ('speech' | 'openai')[] = openaiVoice ? ['openai', 'speech'] : ['speech', 'openai']
    const usable = ways.filter(w => (w === 'speech' ? this.speechConfigured() : this.openai(this.cfg.ttsDeployment)))
    if (!usable.length) throw new ProviderError('azure', 'text to speech is not configured (AZURE_SPEECH_KEY or AZURE_OPENAI_TTS_DEPLOYMENT)')
    let last: unknown
    for (const w of usable) {
      try {
        return w === 'speech' ? await this.speakSpeech(req, speechVoice) : await this.speakOpenAi(req, openaiVoice ? req.voice! : undefined)
      } catch (err) { last = err }
    }
    throw last
  }

  private async speakSpeech(req: SpeakInput, voice?: string): Promise<SpeakOutput> {
    const fmt = SPEECH_FORMATS[req.format]
    const name = voice || defaultVoice(req.language)
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${escapeXml(req.language)}">`
      + `<voice name="${escapeXml(name)}">${escapeXml(req.text)}</voice></speak>`
    const res = await this.send(`https://${this.cfg.speechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.cfg.speechKey, 'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': fmt.header, 'User-Agent': 'jeffi-ai-gateway',
      },
      body: ssml,
    })
    const audio = Buffer.from(await res.arrayBuffer())
    if (!audio.length) throw new ProviderError('azure', 'speech synthesis returned no audio')
    return { audio, mimeType: fmt.mime, model: SPEECH_TTS_MODEL }
  }

  private async speakOpenAi(req: SpeakInput, voice?: string, deployment = this.cfg.ttsDeployment): Promise<SpeakOutput> {
    const fmt = OPENAI_TTS_FORMATS[req.format]
    const res = await this.postJson(this.url(deployment, 'audio/speech'), {
      model: deployment, input: req.text, voice: (voice || 'coral').toLowerCase(), response_format: fmt.format,
    })
    const audio = Buffer.from(await res.arrayBuffer())
    if (!audio.length) throw new ProviderError('azure', 'speech returned no audio')
    return { audio, mimeType: fmt.mime, model: deployment }
  }

  // ── Views for the routers (each capability is configured on its own) ────────
  asImageProvider(): MediaProvider {
    return { name: 'azure', configured: () => this.imageConfigured(), generateImage: req => this.generateImage(req) }
  }

  asVideoProvider(): MediaProvider {
    return {
      name: 'azure',
      configured: () => this.videoConfigured(),
      videoModel: req => this.videoModel(req),
      startVideo: req => this.startVideo(req),
      pollVideo: opId => this.pollVideo(opId),
    }
  }

  asAudioProvider(): AudioProvider {
    return {
      name: 'azure',
      transcribeConfigured: () => this.transcribeConfigured(),
      speakConfigured: () => this.speakConfigured(),
      transcribe: req => this.transcribe(req),
      speak: req => this.speak(req),
    }
  }
}

/** OpenAI SSE chat chunks folded into one response, emitting text deltas and tool-call starts on the way. */
async function readStream(res: Response, emit: (e: AiChatStreamEvent) => void): Promise<ChatResponse> {
  let content = ''
  let model: string | undefined
  let finish: string | null = null
  let usage: ChatResponse['usage']
  const calls: { id: string; name: string; args: string; announced: boolean }[] = []
  const onChunk = (c: ChatResponse) => {
    if (c.model) model = c.model
    if (c.usage) usage = c.usage
    const choice = c.choices?.[0]
    if (!choice) return
    if (choice.finish_reason) finish = choice.finish_reason
    const d = choice.delta
    if (d?.content) { content += d.content; emit({ type: 'text', text: d.content }) }
    for (const tc of d?.tool_calls ?? []) {
      const i = tc.index ?? calls.length
      const call = (calls[i] ??= { id: '', name: '', args: '', announced: false })
      if (tc.id) call.id = tc.id
      if (tc.function?.name) call.name += tc.function.name
      if (tc.function?.arguments) call.args += tc.function.arguments
      if (!call.announced && call.name) { call.announced = true; emit({ type: 'tool_call', id: call.id || undefined, name: call.name }) }
    }
  }
  if (!res.body) throw new ProviderError('azure', 'stream has no body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const line = (raw: string) => {
    const l = raw.trim()
    if (!l.startsWith('data:')) return
    const data = l.slice(5).trim()
    if (!data || data === '[DONE]') return
    try { onChunk(JSON.parse(data) as ChatResponse) } catch { /* keep-alive or partial frame */ }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (value) buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) { line(buf.slice(0, nl)); buf = buf.slice(nl + 1) }
    if (done) break
  }
  if (buf) line(buf)
  const toolCalls = calls.filter(Boolean).map((c, i) => ({ id: c.id || `call_gen_${i}`, type: 'function' as const, function: { name: c.name, arguments: c.args } }))
  return {
    model,
    usage,
    choices: [{ message: { content, tool_calls: toolCalls.length ? toolCalls : undefined }, finish_reason: finish }],
  }
}

export const azureProvider = new AzureProvider()
