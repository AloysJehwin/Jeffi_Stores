import { beforeEach, describe, expect, it } from 'vitest'
import {
  AUDIO_MAX_BASE64, AUDIO_PROVIDER_ORDER, TTS_MAX_CHARS, audioDurationSeconds, estimateSeconds, handleSpeak, handleTranscribe,
  parseAudioProviders, parseSpeakRequest, parseTranscribeRequest, type AudioRouterDeps,
} from '../src/audio'
import { NotConfiguredError, UpstreamError, ValidationError } from '../src/media'
import { loadPrices, unitPrice } from '../src/pricing'
import { ProviderError, type AudioProvider, type SpeakInput, type TranscribeInput } from '../src/providers/types'

beforeEach(() => { loadPrices('') })

function wav(seconds: number, rate = 16000): Buffer {
  const data = Buffer.alloc(Math.round(seconds * rate * 2))
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

function provider(opts: { stt?: boolean; tts?: boolean; fail?: Error; duration?: number; language?: string } = {}) {
  const calls: { transcribe: TranscribeInput[]; speak: SpeakInput[] } = { transcribe: [], speak: [] }
  const p: AudioProvider & { calls: typeof calls } = {
    name: 'azure',
    calls,
    transcribeConfigured: () => opts.stt ?? true,
    speakConfigured: () => opts.tts ?? true,
    async transcribe(req) {
      calls.transcribe.push(req)
      if (opts.fail) throw opts.fail
      return { text: 'hello', language: opts.language, durationSeconds: opts.duration, model: 'gpt-4o-transcribe' }
    },
    async speak(req) {
      calls.speak.push(req)
      if (opts.fail) throw opts.fail
      return { audio: Buffer.from('mp3-bytes'), mimeType: 'audio/mpeg', model: 'azure-speech-tts' }
    },
  }
  return p
}
const deps = (p: AudioProvider | undefined): AudioRouterDeps => ({ providers: p ? { azure: p } : {}, order: AUDIO_PROVIDER_ORDER })

describe('order', () => {
  it('defaults to azure; env order drops unknown names', () => {
    expect(parseAudioProviders(undefined)).toEqual(['azure'])
    expect(parseAudioProviders('bogus, azure')).toEqual(['azure'])
    expect(parseAudioProviders('bogus')).toEqual(['azure'])
  })
})

describe('transcribe validation', () => {
  const b64 = wav(0.1).toString('base64')

  it('accepts base64 audio with a known type and BCP-47 language', () => {
    const r = parseTranscribeRequest({ audioBase64: b64, mimeType: 'Audio/WebM;codecs=opus', language: 'hi-IN', providers: ['azure'] })
    expect(r).toMatchObject({ mimeType: 'audio/webm;codecs=opus', language: 'hi-IN', providers: ['azure'] })
    expect(r.audio.length).toBeGreaterThan(0)
    expect(parseTranscribeRequest({ audioBase64: b64, mimeType: 'audio/wav', language: '' }).language).toBeUndefined()
  })

  it('rejects missing, oversized, prefixed or non-base64 audio, odd types, bad languages and unknown providers', () => {
    const bad = [
      {},
      { audioBase64: 'x'.repeat(AUDIO_MAX_BASE64 + 4), mimeType: 'audio/wav' },
      { audioBase64: `data:audio/wav;base64,${b64}`, mimeType: 'audio/wav' },
      { audioBase64: '***', mimeType: 'audio/wav' },
      { audioBase64: b64, mimeType: 'image/png' },
      { audioBase64: b64, mimeType: 'audio/wav', language: 'not a tag' },
      { audioBase64: b64, mimeType: 'audio/wav', providers: ['google'] },
      { audioBase64: '====', mimeType: 'audio/wav' },
    ]
    for (const r of bad) expect(() => parseTranscribeRequest(r)).toThrow(ValidationError)
  })
})

describe('speak validation', () => {
  it('trims text, defaults to mp3 and requires a language', () => {
    expect(parseSpeakRequest({ text: ' hi ', language: 'ta-IN' })).toEqual({ text: 'hi', language: 'ta-IN', voice: undefined, format: 'mp3', providers: undefined })
    expect(parseSpeakRequest({ text: 'hi', language: 'en-IN', voice: 'en-IN-PrabhatNeural', format: 'ogg' })).toMatchObject({ voice: 'en-IN-PrabhatNeural', format: 'ogg' })
  })

  it('rejects empty or too-long text, a missing language, odd voices and formats', () => {
    const bad = [
      { text: '  ', language: 'hi-IN' },
      { text: 'x'.repeat(TTS_MAX_CHARS + 1), language: 'hi-IN' },
      { text: 'x' },
      { text: 'x', language: 'hi-IN', voice: '<speak>' },
      { text: 'x', language: 'hi-IN', format: 'flac' },
    ]
    for (const r of bad) expect(() => parseSpeakRequest(r)).toThrow(ValidationError)
    expect(() => parseSpeakRequest({ text: 'x'.repeat(TTS_MAX_CHARS), language: 'hi-IN' })).not.toThrow()
  })
})

describe('handleTranscribe', () => {
  it('measures a WAV when the provider gives no length and prices per audio minute', async () => {
    const p = provider()
    const r = await handleTranscribe({ audioBase64: wav(30).toString('base64'), mimeType: 'audio/wav', language: 'hi-IN' }, deps(p))
    expect(r).toMatchObject({ text: 'hello', language: 'hi-IN', durationSeconds: 30, provider: 'azure', model: 'gpt-4o-transcribe' })
    expect(r.usage).toEqual({ units: 0.5, unitType: 'audio_minute', costInr: expect.closeTo(unitPrice('azure', 'gpt-4o-transcribe', 'audio_minute') * 0.5, 4) })
    expect(p.calls.transcribe[0]).toMatchObject({ mimeType: 'audio/wav', language: 'hi-IN' })
  })

  it('prefers the provider length and detected language, else und', async () => {
    const r = await handleTranscribe({ audioBase64: wav(1).toString('base64'), mimeType: 'audio/wav' }, deps(provider({ duration: 12.34, language: 'ta' })))
    expect(r).toMatchObject({ durationSeconds: 12.3, language: 'ta' })
    const u = await handleTranscribe({ audioBase64: Buffer.from('webm-ish').toString('base64'), mimeType: 'audio/webm' }, deps(provider()))
    expect(u.language).toBe('und')
    expect(u.durationSeconds).toBe(Math.round(estimateSeconds(8) * 10) / 10)
  })

  it('503 when nothing is configured; 502 on an outage; 400 for a provider-rejected file', async () => {
    const b64 = wav(1).toString('base64')
    await expect(handleTranscribe({ audioBase64: b64, mimeType: 'audio/wav' }, deps(provider({ stt: false })))).rejects.toBeInstanceOf(NotConfiguredError)
    await expect(handleTranscribe({ audioBase64: b64, mimeType: 'audio/wav' }, deps(undefined))).rejects.toBeInstanceOf(NotConfiguredError)
    const down = await handleTranscribe({ audioBase64: b64, mimeType: 'audio/wav' }, deps(provider({ fail: new ProviderError('azure', 'HTTP 503', 503) }))).catch(e => e)
    expect(down).toBeInstanceOf(UpstreamError)
    expect(down.tried).toEqual([{ provider: 'azure', error: 'azure: HTTP 503' }])
    await expect(handleTranscribe({ audioBase64: b64, mimeType: 'audio/wav' }, deps(provider({ fail: new ProviderError('azure', 'bad file', 400) }))))
      .rejects.toBeInstanceOf(ValidationError)
  })
})

describe('handleSpeak', () => {
  it('returns base64 audio, counts characters and prices per 1k characters', async () => {
    const p = provider()
    const text = 'नमस्ते दुनिया'
    const r = await handleSpeak({ text, language: 'hi-IN', format: 'mp3' }, deps(p))
    const chars = [...text].length
    expect(r).toMatchObject({ audioBase64: Buffer.from('mp3-bytes').toString('base64'), mimeType: 'audio/mpeg', characters: chars, provider: 'azure', model: 'azure-speech-tts' })
    expect(r.usage?.unitType).toBe('tts_1k_chars')
    expect(r.usage?.costInr).toBeCloseTo(unitPrice('azure', 'azure-speech-tts', 'tts_1k_chars') * chars / 1000, 4)
    expect(p.calls.speak[0]).toEqual({ text, language: 'hi-IN', voice: undefined, format: 'mp3' })
  })

  it('503 when no TTS path is configured, 502 when it fails', async () => {
    await expect(handleSpeak({ text: 'x', language: 'hi-IN' }, deps(provider({ tts: false })))).rejects.toBeInstanceOf(NotConfiguredError)
    await expect(handleSpeak({ text: 'x', language: 'hi-IN' }, deps(provider({ fail: new Error('socket hang up') })))).rejects.toBeInstanceOf(UpstreamError)
  })
})

describe('audio length from headers', () => {
  it('reads WAV exactly', () => {
    expect(audioDurationSeconds(wav(2.5), 'audio/wav')).toBeCloseTo(2.5, 3)
  })

  it('reads a CBR MP3 and a Xing frame count', () => {
    const frame = Buffer.alloc(417)
    frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90 // MPEG-1 layer III, 128 kbps, 44.1 kHz
    const cbr = Buffer.concat(Array.from({ length: 100 }, () => frame))
    expect(audioDurationSeconds(cbr, 'audio/mpeg')).toBeCloseTo((cbr.length * 8) / 128_000, 3)
    const xing = Buffer.from(frame)
    xing.write('Xing', 36); xing.writeUInt32BE(1, 40); xing.writeUInt32BE(1000, 44)
    const id3 = Buffer.concat([Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00', 'latin1'), xing])
    expect(audioDurationSeconds(id3, 'audio/mpeg')).toBeCloseTo((1000 * 1152) / 44100, 3)
  })

  it('reads Ogg Opus from the last granule position and MP4 from mvhd', () => {
    const head = Buffer.alloc(40)
    head.write('OggS', 0); head.write('OpusHead', 28); head.writeUInt16LE(312, 38)
    const last = Buffer.alloc(27)
    last.write('OggS', 0); last.writeBigUInt64LE(BigInt(48_000 * 4 + 312), 6)
    expect(audioDurationSeconds(Buffer.concat([head, last]), 'audio/ogg')).toBeCloseTo(4, 3)

    const mp4 = Buffer.alloc(64)
    mp4.write('ftyp', 4); mp4.write('mvhd', 20); mp4[24] = 0
    mp4.writeUInt32BE(1000, 36); mp4.writeUInt32BE(7500, 40)
    expect(audioDurationSeconds(mp4, 'audio/mp4')).toBeCloseTo(7.5, 3)
  })

  it('returns null for unreadable files', () => {
    expect(audioDurationSeconds(Buffer.from('webm'), 'audio/webm')).toBeNull()
    expect(audioDurationSeconds(Buffer.from([0xff, 0xfb, 0x00, 0x00, 0x00]), 'audio/mpeg')).toBeNull()
  })
})
