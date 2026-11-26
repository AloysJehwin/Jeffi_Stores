import { describe, expect, it } from 'vitest'
import { providersReport } from '../src/providers-report'
import { modelSource, options } from '../src/models'
import type { SttProvider, TtsProvider } from '../src/providers/types'

const audio = (name: 'sarvam' | 'azure', stt: boolean, tts: boolean): SttProvider & TtsProvider => ({
  name, transcribeConfigured: () => stt, speakConfigured: () => tts,
  transcribe: async () => ({ text: '', model: 'm' }), speak: async () => ({ audio: Buffer.alloc(0), mimeType: 'audio/mpeg', model: 'm' }),
})
const on = (configured: boolean) => ({ configured: () => configured })

const models = modelSource({
  anthropic: cap => (cap === 'text' ? { models: options(['claude-haiku-5-5', 'claude-sonnet-5-5'], 'claude-haiku-5-5') } : null),
  razer: cap => (cap === 'text' ? { models: options(['gemma4:12b'], 'gemma4:12b') } : cap === 'embed' ? { models: options(['nomic-embed-text'], 'nomic-embed-text') } : cap === 'image' ? { models: options(['sdxl-turbo'], 'sdxl-turbo') } : null),
  azure: cap => ({ models: cap === 'stt' ? options(['azure-speech-stt'], 'azure-speech-stt') : cap === 'tts' ? options(['azure-speech-tts'], 'azure-speech-tts') : [] }),
  google: cap => (cap === 'image' ? { models: options(['gemini-3.1-flash-image'], 'gemini-3.1-flash-image') } : null),
  sarvam: cap => (cap === 'stt' ? { models: options(['saaras:v3', 'saaras:v4'], 'saaras:v3') } : cap === 'tts' ? { models: options(['bulbul:v3'], 'bulbul:v3') } : null),
})

function report() {
  return providersReport({
    models,
    text: {
      order: ['anthropic', 'razer', 'azure'],
      status: {
        anthropic: { name: 'anthropic', configured: true, keyFallback: false },
        razer: { name: 'razer', configured: true, healthy: true },
        azure: { name: 'azure', configured: false },
      },
    },
    image: { order: ['razer', 'google'], providers: { razer: on(true), google: on(false) }, healthy: { razer: false } },
    video: { order: ['google'], providers: { google: on(false) } },
    stt: { order: ['sarvam', 'azure'], providers: { sarvam: audio('sarvam', true, true), azure: audio('azure', false, true) } },
    tts: { order: ['sarvam', 'azure'], providers: { sarvam: audio('sarvam', true, true), azure: audio('azure', false, true) } },
    embed: { default: 'azure', status: { razer: { name: 'razer', configured: true, healthy: true }, azure: { name: 'azure', configured: false } } },
    ocr: [{ name: 'paddleocr', configured: true, healthy: true }],
    ocrModel: 'PP-OCRv5',
    stock: { order: ['pexels'], providers: { pexels: on(true) } },
  })
}

describe('GET /v1/providers', () => {
  it('reports stt and tts separately, each side configured on its own, with their models', () => {
    const r = report()
    expect(r).not.toHaveProperty('audio')
    expect(r.stt).toEqual([
      { name: 'sarvam', configured: true, models: [{ id: 'saaras:v3', label: 'Saaras v3', default: true }, { id: 'saaras:v4', label: 'Saaras v4' }] },
      { name: 'azure', configured: false, models: [{ id: 'azure-speech-stt', label: 'Azure Speech', default: true }] },
    ])
    expect(r.tts.map(s => [s.name, s.configured])).toEqual([['sarvam', true], ['azure', true]])
    expect(r.defaults).toMatchObject({ stt: ['sarvam', 'azure'], tts: ['sarvam', 'azure'], embed: 'azure' })
  })

  it('gives every provider its model list for the capability', () => {
    const r = report()
    expect(r.text[0]).toEqual({ name: 'anthropic', configured: true, keyFallback: false, models: [{ id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', default: true }, { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }] })
    expect(r.text[2]).toEqual({ name: 'azure', configured: false, models: [] })
    expect(r.image).toEqual([
      { name: 'razer', configured: true, healthy: false, models: [{ id: 'sdxl-turbo', label: 'SDXL Turbo', default: true }] },
      { name: 'google', configured: false, models: [{ id: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image', default: true }] },
    ])
    expect(r.video).toEqual([{ name: 'google', configured: false, models: [] }])
    expect(r.embed.map(e => [e.name, e.models.map(m => m.id)])).toEqual([['razer', ['nomic-embed-text']], ['azure', []]])
    expect(r.ocr[0].models).toEqual([{ id: 'PP-OCRv5', label: 'PP-OCRv5', default: true }])
    expect(r.stock).toEqual([{ name: 'pexels', configured: true, models: [] }])
  })
})
