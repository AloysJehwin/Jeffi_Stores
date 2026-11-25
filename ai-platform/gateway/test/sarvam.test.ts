import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SPEAKERS, SarvamProvider, TTS_MAX_CHARS, joinWav, sarvamLanguage, splitText, type SarvamConfig } from '../src/providers/sarvam'
import { ProviderError } from '../src/providers/types'
import { costFor, loadPrices, unitPrice } from '../src/pricing'

const CFG: SarvamConfig = { apiKey: 'sk-test', baseUrl: 'https://sarvam.test', sttModel: 'saaras:v3', ttsModel: 'bulbul:v3', timeoutMs: 5_000 }
const sv = (over: Partial<SarvamConfig> = {}) => new SarvamProvider({ ...CFG, ...over })

type Call = { url: string; init?: RequestInit }
function mockFetch(handler: (url: string, init?: RequestInit, n?: number) => unknown) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const out = handler(url, init, calls.length)
    if (out instanceof Response) return out
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  return calls
}
const body = (c: Call) => JSON.parse(String(c.init?.body))
const form = (c: Call) => c.init?.body as FormData
const headers = (c: Call) => c.init?.headers as Record<string, string>

function wav(samples: number[]): Buffer {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2))
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

beforeEach(() => { loadPrices('') })
afterEach(() => { vi.unstubAllGlobals() })

describe('config and models', () => {
  it('is configured by its key alone', () => {
    expect([sv().transcribeConfigured(), sv().speakConfigured()]).toEqual([true, true])
    expect(sv({ apiKey: '' }).configured()).toBe(false)
  })

  it('lists Saaras for stt and Bulbul for tts, defaults flagged', () => {
    expect(sv().models('stt')!.models).toEqual([
      { id: 'saaras:v3', label: 'Saaras v3', default: true },
      { id: 'saaras:v4', label: 'Saaras v4' },
    ])
    expect(sv({ ttsModel: 'bulbul:v4-flash' }).models('tts')!.models).toEqual([
      { id: 'bulbul:v3', label: 'Bulbul v3' },
      { id: 'bulbul:v4-flash', label: 'Bulbul v4 Flash', default: true },
    ])
    expect(sv().models('text')).toBeNull()
  })

  it('maps BCP-47 to its Indian locale, Odia to od-IN', () => {
    const tts = new Set(['hi-IN', 'od-IN', 'en-IN'])
    expect(sarvamLanguage('hi', tts)).toBe('hi-IN')
    expect(sarvamLanguage('or-IN', tts)).toBe('od-IN')
    expect(sarvamLanguage('en-US', tts)).toBe('en-IN')
    expect(sarvamLanguage('fr-FR', tts)).toBeNull()
  })

  it('prices Saaras per audio minute and Bulbul per 1k characters, in INR', () => {
    expect(unitPrice('sarvam', 'saaras:v3', 'audio_minute')).toBe(0.49)
    expect(unitPrice('sarvam', 'saaras:v4', 'audio_minute')).toBe(0.49)
    expect(unitPrice('sarvam', 'bulbul:v3', 'tts_1k_chars')).toBe(3)
    expect(unitPrice('sarvam', 'bulbul:v4-flash', 'tts_1k_chars')).toBe(2)
    expect(costFor('sarvam', 'bulbul:v4-flash', { tts_1k_chars: 1.5 })).toBe(3)
  })
})

describe('speech to text', () => {
  it('posts the file as multipart with model, mode and language, keyed by api-subscription-key', async () => {
    const calls = mockFetch(() => ({ request_id: 'r', transcript: ' namaste ', language_code: 'hi-IN' }))
    const r = await sv().transcribe({ audio: wav([1, 2, 3]), mimeType: 'audio/wav', language: 'hi' })
    expect(r).toEqual({ text: 'namaste', language: 'hi', model: 'saaras:v3' })
    expect(calls[0].url).toBe('https://sarvam.test/speech-to-text')
    expect(headers(calls[0])).toEqual({ 'api-subscription-key': 'sk-test' })
    const f = form(calls[0])
    expect([f.get('model'), f.get('mode'), f.get('language_code')]).toEqual(['saaras:v3', 'transcribe', 'hi-IN'])
    expect((f.get('file') as File).name).toBe('audio.wav')
  })

  it('detects the language when none is given and uses the chosen model', async () => {
    const calls = mockFetch(() => ({ transcript: 'vanakkam', language_code: 'ta-IN' }))
    const r = await sv().transcribe({ audio: Buffer.from('webm'), mimeType: 'audio/webm;codecs=opus', model: 'saaras:v4' })
    expect(r).toEqual({ text: 'vanakkam', language: 'ta-IN', model: 'saaras:v4' })
    expect(form(calls[0]).get('language_code')).toBe('unknown')
    expect((form(calls[0]).get('file') as File).name).toBe('audio.webm')
  })

  it('400s audio over 30 s and languages it lacks, without a call', async () => {
    const calls = mockFetch(() => ({}))
    await expect(sv().transcribe({ audio: Buffer.from('x'), mimeType: 'audio/wav', durationSeconds: 31 })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('under 30 s') })
    await expect(sv().transcribe({ audio: Buffer.from('x'), mimeType: 'audio/wav', language: 'fr-FR' })).rejects.toMatchObject({ status: 400 })
    await expect(sv({ apiKey: '' }).transcribe({ audio: Buffer.from('x'), mimeType: 'audio/wav' })).rejects.toThrow('SARVAM_API_KEY not set')
    expect(calls).toHaveLength(0)
  })

  it('carries the HTTP status of a failure', async () => {
    mockFetch(() => new Response('{"error":{"message":"quota"}}', { status: 429 }))
    const err = await sv().transcribe({ audio: Buffer.from('x'), mimeType: 'audio/mpeg' }).catch(e => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err).toMatchObject({ status: 429, provider: 'sarvam' })
  })
})

describe('text to speech', () => {
  it('posts JSON with language, model, the language default speaker and codec; decodes the audio', async () => {
    const calls = mockFetch(() => ({ request_id: 'r', audios: [Buffer.from('mp3-a').toString('base64')] }))
    const r = await sv().speak({ text: 'vanakkam', language: 'ta-IN', format: 'mp3' })
    expect(r).toEqual({ audio: Buffer.from('mp3-a'), mimeType: 'audio/mpeg', model: 'bulbul:v3' })
    expect(calls[0].url).toBe('https://sarvam.test/text-to-speech')
    expect(headers(calls[0])).toEqual({ 'api-subscription-key': 'sk-test', 'Content-Type': 'application/json' })
    expect(body(calls[0])).toEqual({
      text: 'vanakkam', language_code: 'ta-IN', model: 'bulbul:v3', speaker: DEFAULT_SPEAKERS['bulbul:v3']['ta-IN'],
      output_audio_codec: 'mp3', speech_sample_rate: 24000,
    })
  })

  it('keeps a speaker of the model, drops an Azure voice name, and maps ogg to opus', async () => {
    const calls = mockFetch(() => ({ audios: [Buffer.from('a').toString('base64')] }))
    await sv().speak({ text: 'x', language: 'hi-IN', format: 'ogg', voice: 'Kavya' })
    expect(body(calls[0])).toMatchObject({ speaker: 'kavya', output_audio_codec: 'opus' })
    await sv().speak({ text: 'x', language: 'hi-IN', format: 'mp3', voice: 'hi-IN-SwaraNeural' })
    expect(body(calls[1]).speaker).toBe('ritu')
    await sv().speak({ text: 'x', language: 'kn-IN', format: 'mp3', model: 'bulbul:v4-flash' })
    expect(body(calls[2])).toMatchObject({ model: 'bulbul:v4-flash', speaker: 'chaitra_kn_conversation' })
    await sv().speak({ text: 'x', language: 'hi-IN', format: 'mp3', model: 'bulbul:v4-flash', voice: 'shubh_hi_devotional' })
    expect(body(calls[3]).speaker).toBe('shubh_hi_devotional')
    await sv({ ttsModel: 'bulbul:v9' }).speak({ text: 'x', language: 'hi-IN', format: 'mp3' })
    expect(body(calls[4]).speaker).toBeUndefined()
  })

  it('400s what it cannot voice: a language, v4-flash Malayalam, long ogg', async () => {
    const calls = mockFetch(() => ({ audios: ['AA=='] }))
    await expect(sv().speak({ text: 'x', language: 'fr-FR', format: 'mp3' })).rejects.toMatchObject({ status: 400 })
    await expect(sv().speak({ text: 'x', language: 'ml-IN', format: 'mp3', model: 'bulbul:v4-flash' })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('no ml-IN voice') })
    await expect(sv().speak({ text: 'a '.repeat(TTS_MAX_CHARS), language: 'hi-IN', format: 'ogg' })).rejects.toMatchObject({ status: 400 })
    expect(calls).toHaveLength(0)
  })

  it('sends long text in parts: mp3 bytes concatenated, wav samples joined under one header', async () => {
    const long = `${'a'.repeat(2000)}. ${'b'.repeat(1500)}.`
    const mp3 = mockFetch((_u, _i, n) => ({ audios: [Buffer.from(`part${n}`).toString('base64')] }))
    const r = await sv().speak({ text: long, language: 'en-IN', format: 'mp3' })
    expect(mp3).toHaveLength(2)
    expect(body(mp3[0]).text).toBe(`${'a'.repeat(2000)}.`)
    expect(r.audio.toString()).toBe('part1part2')

    mockFetch((_u, _i, n) => ({ audios: [wav(n === 1 ? [1, 2] : [3]).toString('base64')] }))
    const w = await sv().speak({ text: long, language: 'en-IN', format: 'wav' })
    expect(w.audio.toString('ascii', 0, 4)).toBe('RIFF')
    expect(w.audio.readUInt32LE(40)).toBe(6)
    expect([w.audio.readInt16LE(44), w.audio.readInt16LE(46), w.audio.readInt16LE(48)]).toEqual([1, 2, 3])
  })

  it('fails on an empty answer', async () => {
    mockFetch(() => ({ audios: [] }))
    await expect(sv().speak({ text: 'x', language: 'hi-IN', format: 'mp3' })).rejects.toThrow('returned no audio')
  })
})

describe('helpers', () => {
  it('splits at sentence ends, then spaces, never over the limit', () => {
    expect(splitText('short', 10)).toEqual(['short'])
    expect(splitText('One two. Three four five. Six.', 12)).toEqual(['One two.', 'Three four', 'five. Six.'])
    expect(splitText('नमस्ते। दुनिया।', 8)).toEqual(['नमस्ते।', 'दुनिया।'])
    expect(splitText('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)])
    for (const part of splitText('word '.repeat(700), 100)) expect([...part].length).toBeLessThanOrEqual(100)
  })

  it('joins WAV parts and refuses anything else', () => {
    const one = wav([5])
    expect(joinWav([one])).toBe(one)
    expect(() => joinWav([one, Buffer.from('not a wav file')])).toThrow('not WAV')
  })
})
