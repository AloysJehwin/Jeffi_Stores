// Sarvam (Indian languages): speech to text (Saaras) and text to speech (Bulbul) over REST, plain fetch.
// Followed docs.sarvam.ai on 2026-11-26: api-reference-docs/speech-to-text/transcribe, api-reference-docs/text-to-speech/
// convert, api/api-guides-tutorials/speech-to-text/overview and .../text-to-speech/voices.
//   stt  POST {base}/speech-to-text, multipart: file, model (saaras:v4 recommended; saaras:v3 legacy; saarika is no
//        longer listed), mode=transcribe, language_code (BCP-47, or 'unknown' to detect) -> { transcript, language_code }.
//        The REST route takes audio under 30 s (longer needs the batch API), so longer files fall through to the next provider.
//   tts  POST {base}/text-to-speech, JSON: text (max 2,500 characters), language_code (11 languages), model (bulbul:v3 |
//        bulbul:v4-flash), speaker, output_audio_codec, speech_sample_rate -> { audios: [base64] }. Longer text is sent
//        in parts and joined (mp3, wav).
// Auth: header api-subscription-key (SARVAM_API_KEY).

import { CONFIG } from '../config'
import { options, type Capability, type ModelList } from '../models'
import type { AudioFormat } from '../../../sdk/types'
import { ProviderError, audioExt, fetchJson, type AudioProvider, type SpeakInput, type SpeakOutput, type TranscribeInput, type TranscribeOutput } from './types'

export type SarvamConfig = typeof CONFIG.sarvam

export const SARVAM_STT_MODELS = ['saaras:v3', 'saaras:v4']
export const SARVAM_TTS_MODELS = ['bulbul:v3', 'bulbul:v4-flash']
export const STT_MAX_SECONDS = 30
export const TTS_MAX_CHARS = 2500

const STT_LANGUAGES = new Set([
  'hi-IN', 'bn-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'od-IN', 'pa-IN', 'ta-IN', 'te-IN', 'en-IN', 'gu-IN', 'as-IN', 'ur-IN', 'ne-IN',
  'kok-IN', 'ks-IN', 'sd-IN', 'sa-IN', 'sat-IN', 'mni-IN', 'brx-IN', 'mai-IN', 'doi-IN',
])
const TTS_LANGUAGES = new Set(['bn-IN', 'en-IN', 'gu-IN', 'hi-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'od-IN', 'pa-IN', 'ta-IN', 'te-IN'])

const V3_SPEAKERS = new Set([
  'shubh', 'aditya', 'ritu', 'priya', 'neha', 'rahul', 'pooja', 'rohan', 'simran', 'kavya', 'amit', 'dev', 'ishita', 'shreya',
  'ratan', 'varun', 'manan', 'sumit', 'roopa', 'kabir', 'aayan', 'ashutosh', 'advait', 'anand', 'tanya', 'tarun', 'sunny',
  'mani', 'gokul', 'vijay', 'shruti', 'suhani', 'mohit', 'kavitha', 'rehan', 'soham', 'rupali',
])
const V4_PERSONA = /^[a-z]+_[a-z]+_[a-z_]+$/

/** Default speaker per language. v3 speakers speak all 11 languages; the docs name no per-language pick, so each
 *  language takes the speaker v4-flash ships a persona of for it (ishita, the docs' top-rated female voice, otherwise).
 *  v4-flash has no Malayalam or Odia persona. */
export const DEFAULT_SPEAKERS: Record<string, Record<string, string>> = {
  'bulbul:v3': {
    'hi-IN': 'ritu', 'en-IN': 'ishita', 'ta-IN': 'gokul', 'te-IN': 'kavitha', 'kn-IN': 'ishita', 'ml-IN': 'ishita',
    'mr-IN': 'ishita', 'bn-IN': 'roopa', 'gu-IN': 'pooja', 'pa-IN': 'anand', 'od-IN': 'ishita',
  },
  'bulbul:v4-flash': {
    'hi-IN': 'ritu_hi_customer_warm', 'en-IN': 'ishita_en_customer', 'ta-IN': 'gokul_ta_narration', 'te-IN': 'kavitha_te_conversation',
    'kn-IN': 'chaitra_kn_conversation', 'mr-IN': 'ishita_mr_conversational', 'bn-IN': 'roopa_bn_conversational',
    'gu-IN': 'pooja_gu_customer', 'pa-IN': 'anand_pa_customer',
  },
}

// Opus needs 8, 16, 24 or 48 kHz; 24 kHz matches Azure's output.
const SAMPLE_RATE = 24000
const CODECS: Record<AudioFormat, { codec: string; mime: string }> = {
  mp3: { codec: 'mp3', mime: 'audio/mpeg' },
  wav: { codec: 'wav', mime: 'audio/wav' },
  ogg: { codec: 'opus', mime: 'audio/ogg' },
}

/** BCP-47 to Sarvam's code: the language's Indian locale (hi, hi-IN, en-US -> en-IN), Odia as od-IN; null if unsupported. */
export function sarvamLanguage(tag: string, supported: Set<string>): string | null {
  const lang = tag.split('-')[0].toLowerCase()
  const code = `${lang === 'or' ? 'od' : lang}-IN`
  return supported.has(code) ? code : null
}

export class SarvamProvider implements AudioProvider {
  readonly name = 'sarvam' as const
  constructor(private readonly cfg: SarvamConfig = CONFIG.sarvam) {}

  configured(): boolean { return !!this.cfg.apiKey }
  transcribeConfigured(): boolean { return this.configured() }
  speakConfigured(): boolean { return this.configured() }

  models(cap: Capability): ModelList | null {
    if (cap === 'stt') return { models: options([...SARVAM_STT_MODELS, this.cfg.sttModel], this.cfg.sttModel) }
    if (cap === 'tts') return { models: options([...SARVAM_TTS_MODELS, this.cfg.ttsModel], this.cfg.ttsModel) }
    return null
  }

  private headers(json = false): Record<string, string> {
    return { 'api-subscription-key': this.cfg.apiKey, ...(json ? { 'Content-Type': 'application/json' } : {}) }
  }

  private assert(): void {
    if (!this.configured()) throw new ProviderError('sarvam', 'SARVAM_API_KEY not set')
  }

  async transcribe(req: TranscribeInput): Promise<TranscribeOutput> {
    this.assert()
    if ((req.durationSeconds ?? 0) > STT_MAX_SECONDS) {
      throw new ProviderError('sarvam', `speech to text takes audio under ${STT_MAX_SECONDS} s (this one is ${Math.round(req.durationSeconds!)} s)`, 400)
    }
    const language = req.language ? sarvamLanguage(req.language, STT_LANGUAGES) : 'unknown'
    if (!language) throw new ProviderError('sarvam', `speech to text does not support ${req.language}`, 400)
    const model = req.model || this.cfg.sttModel
    const mime = req.mimeType.split(';')[0].trim()
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(req.audio)], { type: mime }), `audio.${audioExt(mime)}`)
    form.append('model', model)
    form.append('mode', 'transcribe')
    form.append('language_code', language)
    const r = await fetchJson<{ transcript?: string; language_code?: string | null }>('sarvam', `${this.cfg.baseUrl}/speech-to-text`, {
      method: 'POST', headers: this.headers(), body: form, timeoutMs: this.cfg.timeoutMs,
    })
    return { text: (r.transcript ?? '').trim(), language: req.language ?? (r.language_code || undefined), model }
  }

  async speak(req: SpeakInput): Promise<SpeakOutput> {
    this.assert()
    const model = req.model || this.cfg.ttsModel
    const language = sarvamLanguage(req.language, TTS_LANGUAGES)
    if (!language) throw new ProviderError('sarvam', `text to speech does not support ${req.language}`, 400)
    const speaker = this.speaker(model, language, req.voice)
    const fmt = CODECS[req.format]
    const parts = splitText(req.text, TTS_MAX_CHARS)
    if (parts.length > 1 && req.format === 'ogg') throw new ProviderError('sarvam', `ogg output takes at most ${TTS_MAX_CHARS} characters`, 400)
    const audio: Buffer[] = []
    for (const text of parts) {
      const r = await fetchJson<{ audios?: string[] }>('sarvam', `${this.cfg.baseUrl}/text-to-speech`, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({ text, language_code: language, model, speaker, output_audio_codec: fmt.codec, speech_sample_rate: SAMPLE_RATE }),
        timeoutMs: this.cfg.timeoutMs,
      })
      const bytes = Buffer.concat((r.audios ?? []).map(a => Buffer.from(a, 'base64')))
      if (!bytes.length) throw new ProviderError('sarvam', 'text to speech returned no audio')
      audio.push(bytes)
    }
    return { audio: req.format === 'wav' ? joinWav(audio) : Buffer.concat(audio), mimeType: fmt.mime, model }
  }

  /** The caller's voice when it is a speaker of this model (an Azure voice name is not), else the language's default
   *  (none for a model this file does not know: Sarvam picks). */
  private speaker(model: string, language: string, voice?: string): string | undefined {
    const v = voice?.toLowerCase()
    if (v && (model === 'bulbul:v3' ? V3_SPEAKERS.has(v) : V4_PERSONA.test(v))) return v
    const defaults = DEFAULT_SPEAKERS[model]
    if (defaults && !defaults[language]) throw new ProviderError('sarvam', `${model} has no ${language} voice`, 400)
    return defaults?.[language]
  }
}

/** Text in parts of at most `max` characters, split at sentence ends, then spaces. */
export function splitText(text: string, max: number): string[] {
  if ([...text].length <= max) return [text]
  const out: string[] = []
  let cur = ''
  for (const sentence of text.split(/(?<=[.!?।॥\n])\s+/)) {
    for (const part of hardSplit(sentence, max)) {
      if (cur && [...cur].length + 1 + [...part].length > max) { out.push(cur); cur = '' }
      cur = cur ? `${cur} ${part}` : part
    }
  }
  if (cur) out.push(cur)
  return out
}

function hardSplit(s: string, max: number): string[] {
  const cps = [...s.trim()]
  const out: string[] = []
  let i = 0
  while (i < cps.length) {
    let end = Math.min(cps.length, i + max)
    if (end < cps.length) {
      const sp = cps.lastIndexOf(' ', end)
      if (sp > i) end = sp
    }
    const part = cps.slice(i, end).join('').trim()
    if (part) out.push(part)
    i = end
  }
  return out
}

/** WAV parts as one file: the first part's format, every part's samples. */
export function joinWav(parts: Buffer[]): Buffer {
  if (parts.length === 1) return parts[0]
  let fmt: Buffer | null = null
  const data: Buffer[] = []
  for (const p of parts) {
    const c = wavChunks(p)
    if (!c) throw new ProviderError('sarvam', 'text to speech returned audio that is not WAV')
    fmt ??= c.fmt
    data.push(c.data)
  }
  const body = Buffer.concat(data)
  const head = Buffer.alloc(28 + fmt!.length)
  head.write('RIFF', 0); head.writeUInt32LE(head.length - 8 + body.length, 4); head.write('WAVE', 8)
  head.write('fmt ', 12); head.writeUInt32LE(fmt!.length, 16); fmt!.copy(head, 20)
  head.write('data', 20 + fmt!.length); head.writeUInt32LE(body.length, 24 + fmt!.length)
  return Buffer.concat([head, body])
}

function wavChunks(buf: Buffer): { fmt: Buffer; data: Buffer } | null {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
  let fmt: Buffer | null = null
  for (let i = 12; i + 8 <= buf.length;) {
    const id = buf.toString('ascii', i, i + 4)
    const size = buf.readUInt32LE(i + 4)
    if (id === 'fmt ') fmt = buf.subarray(i + 8, i + 8 + size)
    if (id === 'data') return fmt ? { fmt, data: buf.subarray(i + 8, Math.min(buf.length, i + 8 + size)) } : null
    i += 8 + size + (size % 2)
  }
  return null
}

export const sarvamProvider = new SarvamProvider()
