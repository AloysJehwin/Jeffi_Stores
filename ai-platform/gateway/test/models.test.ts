import { describe, expect, it, vi } from 'vitest'
import {
  InstalledModels, RAZER_IMAGE_MODEL, checkModel, modelLabel, modelSource, options, parseModels, razerModels, type ModelSource,
} from '../src/models'
import { CONFIG, VISION_MODEL, claudeModelFor, modelForHint, ollamaModelFor } from '../src/config'
import { ValidationError } from '../src/errors'
import { anthropicModels } from '../src/providers/anthropic'
import { AzureProvider, type AzureConfig } from '../src/providers/azure'
import { GoogleProvider } from '../src/providers/google'
import { ReplicateProvider } from '../src/providers/replicate'

const source: ModelSource = modelSource({
  anthropic: cap => (cap === 'text' ? { models: options(['claude-haiku-5-5', 'claude-sonnet-5-5'], 'claude-haiku-5-5') } : null),
  razer: cap => (cap === 'text' ? { models: options(['gemma4:12b']), open: true } : null),
  azure: cap => (cap === 'text' ? { models: [] } : cap === 'embed' ? { models: options(['emb']), aliases: { 'text-embedding-3-small@768': 'emb' } } : null),
})

describe('model choice', () => {
  it('keeps listed models, drops empty entries, and is undefined when nothing is chosen', () => {
    expect(parseModels({ anthropic: 'claude-sonnet-5-5', razer: '', azure: null }, 'text', source)).toEqual({ anthropic: 'claude-sonnet-5-5' })
    expect(parseModels(undefined, 'text', source)).toBeUndefined()
    expect(parseModels({ anthropic: '' }, 'text', source)).toBeUndefined()
  })

  it('400s a model off the list, an unknown provider, a provider of another capability and bad shapes', () => {
    expect(() => parseModels({ anthropic: 'claude-opus-9' }, 'text', source))
      .toThrow('anthropic has no text model "claude-opus-9"; allowed: claude-haiku-5-5, claude-sonnet-5-5')
    expect(() => parseModels({ openai: 'gpt' }, 'text', source)).toThrow('openai is not a text provider')
    expect(() => parseModels({ anthropic: 'claude-haiku-5-5' }, 'image', source)).toThrow('anthropic is not a image provider')
    expect(() => parseModels(['claude'], 'text', source)).toThrow(ValidationError)
    expect(() => parseModels('claude', 'text', source)).toThrow(ValidationError)
    expect(() => parseModels({ anthropic: 5 }, 'text', source)).toThrow('models.anthropic is not a model id')
    expect(() => parseModels({ anthropic: 'has space' }, 'text', source)).toThrow(ValidationError)
  })

  it('lets anything through an open or empty list, resolves aliases, and checks only the id without a source', () => {
    expect(parseModels({ razer: 'qwen3:30b', azure: 'any-deployment' }, 'text', source)).toEqual({ razer: 'qwen3:30b', azure: 'any-deployment' })
    expect(checkModel('azure', 'text-embedding-3-small@768', 'embed', source)).toBe('emb')
    expect(() => checkModel('azure', 'other', 'embed', source)).toThrow('azure has no embeddings model "other"; allowed: emb')
    expect(checkModel('whoever', 'm', 'stt')).toBe('m')
  })

  it('applies a chosen model in place of the hint model, keeping the hint effort', () => {
    expect(claudeModelFor({ modelHint: 'deep', models: { anthropic: 'claude-haiku-5-5' } })).toEqual({ model: 'claude-haiku-5-5', effort: 'high' })
    expect(claudeModelFor({ modelHint: 'fast' }).model).toBe('claude-haiku-5-5')
    expect(ollamaModelFor({ modelHint: 'sql', models: { razer: 'qwen3:30b' } })).toBe('qwen3:30b')
    expect(ollamaModelFor({ modelHint: 'fast' })).toBe(modelForHint('fast'))
  })
})

describe('labels', () => {
  it('reads like a product name', () => {
    expect(modelLabel('claude-sonnet-5-5')).toBe('Claude Sonnet 5.5')
    expect(modelLabel('claude-opus-4-8')).toBe('Claude Opus 4.8')
    expect(modelLabel('gemma4:12b')).toBe('Gemma4 12B')
    expect(modelLabel('qwen2.5:7b')).toBe('Qwen2.5 7B')
    expect(modelLabel('nomic-embed-text:latest')).toBe('Nomic Embed Text')
    expect(modelLabel('gpt-4o-mini-transcribe')).toBe('GPT 4o Mini Transcribe')
    expect(modelLabel('black-forest-labs/flux-1.1-pro')).toBe('FLUX 1.1 Pro')
    expect(modelLabel('wan-video/wan-2.2-t2v-fast')).toBe('Wan 2.2 T2V Fast')
    expect(modelLabel('bulbul:v4-flash')).toBe('Bulbul v4 Flash')
    expect(modelLabel('sdxl-turbo')).toBe('SDXL Turbo')
    expect(modelLabel('text-embedding-3-small@768')).toBe('Text Embedding 3 Small')
    expect(modelLabel('azure-speech-stt')).toBe('Azure Speech')
    expect(modelLabel('---')).toBe('---')
  })

  it('options dedupe, skip blanks and flag the default', () => {
    expect(options(['a', '', 'b', 'a', undefined], 'b')).toEqual([{ id: 'a', label: 'A' }, { id: 'b', label: 'B', default: true }])
  })
})

describe('Ollama installed models', () => {
  it('is null until a fetch succeeds, keeps the last good list through an outage, refreshes when stale', async () => {
    let t = 0
    let fail = false
    const fetchNames = vi.fn(async () => { if (fail) throw new Error('down'); return ['gemma4:12b', 'nomic-embed-text:latest', 'gemma4:12b'] })
    const m = new InstalledModels(fetchNames, 1000, () => t)
    expect(m.list()).toBeNull()
    await m.refresh()
    expect(m.list()).toEqual(['gemma4:12b', 'nomic-embed-text'])
    expect(fetchNames).toHaveBeenCalledTimes(1)
    fail = true
    t = 1000
    expect(m.list()).toEqual(['gemma4:12b', 'nomic-embed-text'])
    await m.refresh()
    expect(fetchNames).toHaveBeenCalledTimes(2)
    expect(m.list()).toEqual(['gemma4:12b', 'nomic-embed-text'])
    t = 2500
    await Promise.all([m.refresh(), m.refresh()])
    expect(fetchNames).toHaveBeenCalledTimes(3)
  })

  it('razer: configured hint models plus installed text models; embed models apart; one image model', () => {
    let installed: string[] | null = null
    const r = razerModels(() => installed)
    const text = r('text')!
    expect(text.open).toBe(true)
    expect(text.models.find(m => m.default)?.id).toBe(modelForHint(undefined))
    expect(text.models.map(m => m.id)).toEqual(expect.arrayContaining([modelForHint('agent'), modelForHint('fast'), VISION_MODEL]))
    installed = ['llama3.3:70b', 'mxbai-embed-large']
    expect(r('text')!.open).toBe(false)
    expect(r('text')!.models.map(m => m.id)).toContain('llama3.3:70b')
    expect(r('text')!.models.map(m => m.id)).not.toContain('mxbai-embed-large')
    expect(r('embed')!.models).toEqual([{ id: CONFIG.embedModel, label: 'Nomic Embed Text', default: true }, { id: 'mxbai-embed-large', label: 'Mxbai Embed Large' }])
    expect(r('image')!.models).toEqual([{ id: RAZER_IMAGE_MODEL, label: 'SDXL Turbo', default: true }])
    expect(r('stt')).toBeNull()
  })
})

describe('provider lists', () => {
  it('anthropic: AI_ANTHROPIC_MODELS with today\'s copy default flagged', () => {
    const t = anthropicModels('text')!
    expect(t.models.map(m => m.id)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])
    expect(t.models.find(m => m.default)).toEqual({ id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', default: true })
    expect(anthropicModels('image')).toBeNull()
  })

  it('azure: each capability\'s deployments, the singular one the default; Speech as azure-speech-*', () => {
    const cfg: AzureConfig = {
      endpoint: 'https://r.openai.azure.com', apiKey: 'k', apiVersion: 'v', chatDeployment: 'gpt-4.1-mini', chatDeployments: ['gpt-4.1-mini', 'gpt-5'],
      imageDeployment: 'gpt-image-1', embedDeployment: 'emb', embedDeployments: ['emb', 'emb-large'], transcribeDeployment: 'gpt-4o-transcribe',
      ttsDeployment: 'tts-hd', videoDeployment: '', speechKey: 's', speechRegion: 'centralindia', timeoutMs: 1000, minMaxTokens: 1,
    }
    const a = new AzureProvider(cfg)
    expect(a.models('text')!.models).toEqual([{ id: 'gpt-4.1-mini', label: 'GPT 4.1 Mini', default: true }, { id: 'gpt-5', label: 'GPT 5' }])
    expect(a.models('image')!.models.map(m => m.id)).toEqual(['gpt-image-1'])
    expect(a.models('video')!.models).toEqual([])
    expect(a.models('embed')).toMatchObject({ models: [{ id: 'emb', default: true }, { id: 'emb-large' }], aliases: { 'text-embedding-3-small@768': 'emb', 'emb-large@768': 'emb-large' } })
    expect(a.models('stt')!.models).toEqual([{ id: 'gpt-4o-transcribe', label: 'GPT 4o Transcribe', default: true }, { id: 'azure-speech-stt', label: 'Azure Speech' }])
    expect(a.models('tts')!.models).toEqual([{ id: 'azure-speech-tts', label: 'Azure Speech', default: true }, { id: 'tts-hd', label: 'TTS HD' }])
    const speechOnly = new AzureProvider({ ...cfg, transcribeDeployment: '', ttsDeployment: '' })
    expect(speechOnly.models('stt')!.models).toEqual([{ id: 'azure-speech-stt', label: 'Azure Speech', default: true }])
    expect(new AzureProvider({ ...cfg, speechKey: '' }).models('tts')!.models).toEqual([{ id: 'tts-hd', label: 'TTS HD', default: true }])
  })

  it('google and replicate: the configured models first, defaults flagged', () => {
    const g = new GoogleProvider('k', 'gemini-3.1-flash-image', 'gemini-3-pro-image', '', 'veo-3.1-fast-generate-preview', 'veo-3.0-generate-001')
    const img = g.models('image')!.models
    expect(img.slice(0, 2).map(m => m.id)).toEqual(['gemini-3.1-flash-image', 'gemini-3-pro-image'])
    expect(img.find(m => m.default)?.id).toBe('gemini-3.1-flash-image')
    expect(img.map(m => m.id)).toContain('imagen-4.0-generate-001')
    expect(g.models('video')!.models[0]).toEqual({ id: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast Generate Preview', default: true })
    expect(g.models('text')).toBeNull()
    const r = new ReplicateProvider('t')
    expect(r.models('image')!.models.find(m => m.default)?.id).toBe('black-forest-labs/flux-dev')
    expect(r.models('video')!.models.map(m => m.id)).toEqual(['wan-video/wan-2.2-t2v-fast', 'wan-video/wan-2.2-i2v-fast'])
    expect(r.models('stt')).toBeNull()
  })
})
