import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockTranscribe } = vi.hoisted(() => ({ mockTranscribe: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn() }))
vi.mock('@/lib/admin-agent/vision', () => ({ ocrImage: vi.fn(), ocrPdfPages: vi.fn() }))
vi.mock('@/lib/admin-agent/pdf', () => ({ pdfText: vi.fn() }))
vi.mock('@/lib/shared/transcribe', () => ({ transcribeAudio: mockTranscribe }))

import { readAttachment } from '@/lib/admin-agent/files'
import { resolveMime, unsupportedMessage } from '@/lib/admin-agent/file-types'

describe('admin agent audio files', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts audio types and resolves them from the extension', () => {
    expect(resolveMime('note.mp3', '')).toBe('audio/mpeg')
    expect(resolveMime('memo.m4a', 'application/octet-stream')).toBe('audio/mp4')
    expect(resolveMime('clip.wav', 'audio/x-wav')).toBe('audio/x-wav')
    expect(unsupportedMessage('video/mp4')).toMatch(/cannot watch video/i)
  })

  it('transcribes an audio attachment', async () => {
    mockTranscribe.mockResolvedValue({ ok: true, text: 'please quote 50 bolts', language: 'en', durationSeconds: 5, provider: 'azure', model: 'whisper' })
    const r = await readAttachment(Buffer.from('audio'), 'audio/mpeg')
    expect(r).toEqual({ ok: true, text: 'please quote 50 bolts', source: 'audio_transcript', model: 'whisper' })
    expect(mockTranscribe).toHaveBeenCalledWith({ audio: Buffer.from('audio'), mimeType: 'audio/mpeg', feature: 'agent_file_read' })
  })

  it('returns a clear reason when no audio provider is configured', async () => {
    mockTranscribe.mockResolvedValue({ ok: false, code: 'unavailable', reason: 'Audio transcription is not set up. Ask the store owner.' })
    const r = await readAttachment(Buffer.from('audio'), 'audio/mpeg')
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/not set up/) })
  })

  it('hints to trim an oversize recording', async () => {
    mockTranscribe.mockResolvedValue({ ok: false, code: 'too_large', reason: 'The recording is over 10 MB' })
    const r = await readAttachment(Buffer.from('audio'), 'audio/mpeg')
    expect(r).toMatchObject({ ok: false, hint: expect.stringMatching(/shorter/) })
  })
})
