import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAiTranscribe } = vi.hoisted(() => ({ mockAiTranscribe: vi.fn() }))
vi.mock('@/lib/shared/ai-client', () => ({ aiTranscribe: mockAiTranscribe }))

import { transcribeAudio, normalizeLanguageHint, MAX_TRANSCRIBE_BYTES } from '@/lib/shared/transcribe'

const base = { audio: Buffer.from('abc'), mimeType: 'audio/webm', feature: 'staff_voice_memo' }

describe('normalizeLanguageHint', () => {
  it('keeps BCP-47 tags and drops auto, empty and junk', () => {
    expect(normalizeLanguageHint('hi-IN')).toBe('hi-IN')
    expect(normalizeLanguageHint(' en ')).toBe('en')
    expect(normalizeLanguageHint('auto')).toBeUndefined()
    expect(normalizeLanguageHint('')).toBeUndefined()
    expect(normalizeLanguageHint(null)).toBeUndefined()
    expect(normalizeLanguageHint('hindi!')).toBeUndefined()
  })
})

describe('transcribeAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns the transcript and passes the language hint and feature through', async () => {
    mockAiTranscribe.mockResolvedValue({ text: ' namaste ', language: 'hi-IN', durationSeconds: 4, provider: 'azure', model: 'whisper' })
    const r = await transcribeAudio({ ...base, language: 'hi-IN' })
    expect(r).toEqual({ ok: true, text: 'namaste', language: 'hi-IN', durationSeconds: 4, provider: 'azure', model: 'whisper' })
    expect(mockAiTranscribe).toHaveBeenCalledWith({ audio: base.audio, mimeType: 'audio/webm', language: 'hi-IN', feature: 'staff_voice_memo' })
  })

  it('rejects empty and oversize audio without calling the gateway', async () => {
    expect(await transcribeAudio({ ...base, audio: Buffer.alloc(0) })).toMatchObject({ ok: false, code: 'empty' })
    expect(await transcribeAudio({ ...base, audio: Buffer.alloc(MAX_TRANSCRIBE_BYTES + 1) })).toMatchObject({ ok: false, code: 'too_large' })
    expect(mockAiTranscribe).not.toHaveBeenCalled()
  })

  it('reports silence when the provider returns no text', async () => {
    mockAiTranscribe.mockResolvedValue({ text: '  ', language: 'en', durationSeconds: 1, provider: 'azure', model: 'm' })
    expect(await transcribeAudio(base)).toMatchObject({ ok: false, code: 'empty' })
  })

  it('maps a missing audio provider to a clear message', async () => {
    mockAiTranscribe.mockRejectedValue(new Error('No audio provider configured'))
    const r = await transcribeAudio(base)
    expect(r).toMatchObject({ ok: false, code: 'unavailable' })
    expect((r as any).reason).toMatch(/not set up/i)
  })

  it('maps other failures to a retryable message', async () => {
    mockAiTranscribe.mockRejectedValue(new Error('HTTP 500'))
    expect(await transcribeAudio(base)).toMatchObject({ ok: false, code: 'failed' })
  })
})
