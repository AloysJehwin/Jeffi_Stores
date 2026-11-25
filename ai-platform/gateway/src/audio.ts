// Routing + validation for /v1/audio/transcribe and /v1/audio/speak. Same order rules as images: the requested
// order (tenant policy) else the gateway default, unconfigured providers skipped, a failing one falls through.

import type {
  AudioFormat, AudioProviderName, SpeakRequest, SpeakResponse, TranscribeRequest, TranscribeResponse,
} from '../../sdk/types'
import { NotConfiguredError, UpstreamError, ValidationError, parseProviders, parseRequestedProviders } from './media'
import { costFor, round } from './pricing'
import { ProviderError, type AudioProvider } from './providers/types'

export const AUDIO_PROVIDER_ORDER: AudioProviderName[] = ['azure']
const AUDIO_PROVIDER_SET = new Set<AudioProviderName>(['azure'])
/** Decoded audio cap, and the base64 length that carries it. */
export const AUDIO_MAX_BYTES = 25 * 1024 * 1024
export const AUDIO_MAX_BASE64 = Math.ceil(AUDIO_MAX_BYTES / 3) * 4
export const TTS_MAX_CHARS = 5000

const FORMATS = new Set<AudioFormat>(['mp3', 'wav', 'ogg'])
const AUDIO_MIMES = new Set([
  'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac',
  'audio/ogg', 'audio/opus', 'audio/webm', 'audio/flac', 'audio/x-flac', 'video/mp4', 'video/webm', 'video/quicktime',
])
const BCP47 = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/
const VOICE = /^[A-Za-z0-9:_-]{1,80}$/
const BASE64 = /^[A-Za-z0-9+/=\s]+$/

export function parseAudioProviders(raw: string | undefined): AudioProviderName[] {
  return parseProviders(raw, AUDIO_PROVIDER_ORDER, AUDIO_PROVIDER_SET)
}
export const parseAudioOrder = (raw: unknown) => parseRequestedProviders(raw, AUDIO_PROVIDER_SET, 'audio')

export interface AudioRouterDeps {
  providers: Partial<Record<AudioProviderName, AudioProvider>>
  order: AudioProviderName[]
}

function language(raw: unknown, required: boolean): string | undefined {
  if (raw == null || raw === '') {
    if (required) throw new ValidationError('language is required (BCP-47, e.g. hi-IN)')
    return undefined
  }
  if (typeof raw !== 'string' || !BCP47.test(raw.trim())) throw new ValidationError('language must be a BCP-47 tag, e.g. hi-IN')
  return raw.trim()
}

export function parseTranscribeRequest(raw: unknown): { audio: Buffer; mimeType: string; language?: string; providers?: AudioProviderName[] } {
  const r = (raw ?? {}) as Partial<TranscribeRequest>
  const b64 = r.audioBase64
  if (typeof b64 !== 'string' || !b64) throw new ValidationError('audioBase64 is required')
  if (b64.length > AUDIO_MAX_BASE64) throw new ValidationError(`audio is too large (max ${AUDIO_MAX_BYTES / 1024 / 1024} MB)`)
  if (b64.startsWith('data:')) throw new ValidationError('audioBase64 must be bare base64, without a data: prefix')
  if (!BASE64.test(b64)) throw new ValidationError('audioBase64 is not base64')
  const mimeType = typeof r.mimeType === 'string' ? r.mimeType.trim().toLowerCase() : ''
  if (!AUDIO_MIMES.has(mimeType.split(';')[0].trim())) throw new ValidationError(`mimeType must be one of ${[...AUDIO_MIMES].join(', ')}`)
  const audio = Buffer.from(b64, 'base64')
  if (!audio.length) throw new ValidationError('audio is empty')
  return { audio, mimeType, language: language(r.language, false), providers: parseAudioOrder(r.providers) }
}

export function parseSpeakRequest(raw: unknown): { text: string; language: string; voice?: string; format: AudioFormat; providers?: AudioProviderName[] } {
  const r = (raw ?? {}) as Partial<SpeakRequest>
  const text = typeof r.text === 'string' ? r.text.trim() : ''
  if (!text) throw new ValidationError('text is required')
  if ([...text].length > TTS_MAX_CHARS) throw new ValidationError(`text is too long (max ${TTS_MAX_CHARS} characters)`)
  const voice = r.voice == null || r.voice === '' ? undefined : r.voice
  if (voice !== undefined && (typeof voice !== 'string' || !VOICE.test(voice))) throw new ValidationError('voice is not a valid voice name')
  const format = (r.format ?? 'mp3') as AudioFormat
  if (!FORMATS.has(format)) throw new ValidationError('format must be mp3, wav or ogg')
  return { text, language: language(r.language, true)!, voice, format, providers: parseAudioOrder(r.providers) }
}

function route(deps: AudioRouterDeps, requested: AudioProviderName[] | undefined, side: 'transcribe' | 'speak'): AudioProvider[] {
  const ok = (p: AudioProvider | undefined): p is AudioProvider => !!p && (side === 'transcribe' ? p.transcribeConfigured() : p.speakConfigured())
  const list = (requested ?? deps.order).map(n => deps.providers[n]).filter(ok)
  if (!list.length) throw new NotConfiguredError(`no ${side === 'transcribe' ? 'speech-to-text' : 'text-to-speech'} provider configured`)
  return list
}

/** A provider's own 4xx for the input (bad file, unsupported format) is the caller's error, not an outage. */
function failure(message: string, tried: { provider: string; error: string }[], last: unknown): Error {
  const s = last instanceof ProviderError ? last.status : undefined
  if (s && s >= 400 && s < 500 && ![401, 403, 404, 408, 429].includes(s)) return new ValidationError(last instanceof Error ? last.message : message)
  return new UpstreamError(message, tried)
}

export async function handleTranscribe(raw: unknown, deps: AudioRouterDeps): Promise<TranscribeResponse> {
  const p = parseTranscribeRequest(raw)
  const tried: { provider: string; error: string }[] = []
  let last: unknown
  for (const provider of route(deps, p.providers, 'transcribe')) {
    try {
      const out = await provider.transcribe({ audio: p.audio, mimeType: p.mimeType, language: p.language })
      const measured = out.durationSeconds ?? audioDurationSeconds(p.audio, p.mimeType) ?? estimateSeconds(p.audio.length)
      const durationSeconds = round(Math.max(0, measured), 1)
      const minutes = durationSeconds / 60
      return {
        text: out.text,
        language: out.language || p.language || 'und',
        durationSeconds,
        provider: provider.name,
        model: out.model,
        usage: { units: round(minutes, 4), unitType: 'audio_minute', costInr: costFor(provider.name, out.model, { audio_minute: minutes }) },
      }
    } catch (err) {
      last = err
      tried.push({ provider: provider.name, error: err instanceof Error ? err.message : String(err) })
    }
  }
  throw failure('speech-to-text failed on all providers', tried, last)
}

export async function handleSpeak(raw: unknown, deps: AudioRouterDeps): Promise<SpeakResponse> {
  const p = parseSpeakRequest(raw)
  const characters = [...p.text].length
  const tried: { provider: string; error: string }[] = []
  let last: unknown
  for (const provider of route(deps, p.providers, 'speak')) {
    try {
      const out = await provider.speak({ text: p.text, language: p.language, voice: p.voice, format: p.format })
      const k = characters / 1000
      return {
        audioBase64: out.audio.toString('base64'),
        mimeType: out.mimeType,
        characters,
        provider: provider.name,
        model: out.model,
        usage: { units: round(k, 4), unitType: 'tts_1k_chars', costInr: costFor(provider.name, out.model, { tts_1k_chars: k }) },
      }
    } catch (err) {
      last = err
      tried.push({ provider: provider.name, error: err instanceof Error ? err.message : String(err) })
    }
  }
  throw failure('text-to-speech failed on all providers', tried, last)
}

/** Last resort for formats without a readable length (WebM from MediaRecorder): ~32 kbps Opus. */
export function estimateSeconds(bytes: number): number {
  return (bytes * 8) / 32_000
}

/** Length of a WAV, MP3, Ogg (Opus/Vorbis) or MP4/M4A file from its headers; null when unreadable. */
export function audioDurationSeconds(buf: Buffer, mime: string): number | null {
  try {
    if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return wavSeconds(buf)
    if (buf.length > 4 && buf.toString('ascii', 0, 4) === 'OggS') return oggSeconds(buf)
    if (buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp') return mp4Seconds(buf)
    const m = mime.split(';')[0].trim()
    if (m === 'audio/mpeg' || m === 'audio/mp3' || buf.toString('ascii', 0, 3) === 'ID3') return mp3Seconds(buf)
  } catch { /* truncated or odd file: fall through */ }
  return null
}

function wavSeconds(buf: Buffer): number | null {
  let byteRate = 0
  let i = 12
  while (i + 8 <= buf.length) {
    const id = buf.toString('ascii', i, i + 4)
    const size = buf.readUInt32LE(i + 4)
    if (id === 'fmt ') byteRate = buf.readUInt32LE(i + 16)
    if (id === 'data') {
      const bytes = size === 0xffffffff || i + 8 + size > buf.length ? buf.length - i - 8 : size
      return byteRate ? bytes / byteRate : null
    }
    i += 8 + size + (size % 2)
  }
  return null
}

function oggSeconds(buf: Buffer): number | null {
  const opus = buf.indexOf('OpusHead')
  let rate = 0
  let skip = 0
  if (opus >= 0) { rate = 48_000; skip = buf.readUInt16LE(opus + 10) } else {
    const vorbis = buf.indexOf('\x01vorbis', 0, 'latin1')
    if (vorbis >= 0) rate = buf.readUInt32LE(vorbis + 12)
  }
  const last = buf.lastIndexOf('OggS')
  if (!rate || last < 0 || last + 14 > buf.length) return null
  const granule = Number(buf.readBigUInt64LE(last + 6))
  return granule > skip ? (granule - skip) / rate : null
}

function mp4Seconds(buf: Buffer): number | null {
  const i = buf.indexOf('mvhd')
  if (i < 0) return null
  const v = buf[i + 4]
  const scale = v === 1 ? buf.readUInt32BE(i + 24) : buf.readUInt32BE(i + 16)
  const dur = v === 1 ? Number(buf.readBigUInt64BE(i + 28)) : buf.readUInt32BE(i + 20)
  return scale ? dur / scale : null
}

const MP3_BITRATES: Record<string, number[]> = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

/** Layer III: frame count from a Xing/Info header when present, else constant bitrate from the first frame. */
function mp3Seconds(buf: Buffer): number | null {
  let i = 0
  if (buf.toString('ascii', 0, 3) === 'ID3') i = 10 + ((buf[6] & 0x7f) << 21 | (buf[7] & 0x7f) << 14 | (buf[8] & 0x7f) << 7 | (buf[9] & 0x7f))
  while (i + 4 < buf.length && !(buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0)) i++
  if (i + 4 >= buf.length) return null
  const version = (buf[i + 1] >> 3) & 3
  const bitrate = (version === 3 ? MP3_BITRATES.v1 : MP3_BITRATES.v2)[(buf[i + 2] >> 4) & 15]
  const rate = MP3_RATES[version]?.[(buf[i + 2] >> 2) & 3]
  if (!bitrate || !rate) return null
  const samples = version === 3 ? 1152 : 576
  const head = buf.subarray(i, Math.min(buf.length, i + 200))
  const xing = Math.max(head.indexOf('Xing'), head.indexOf('Info'))
  if (xing >= 0 && head.length >= xing + 12 && (head.readUInt32BE(xing + 4) & 1)) return (head.readUInt32BE(xing + 8) * samples) / rate
  return ((buf.length - i) * 8) / (bitrate * 1000)
}
