// Speech to text for app features (staff voice memos, admin-agent audio files). Wraps aiTranscribe
// with the size limit and a plain-language result instead of a thrown gateway error.

export const MAX_TRANSCRIBE_BYTES = 10 * 1024 * 1024
export const MAX_TRANSCRIBE_SECONDS = 10 * 60

interface TranscribeFn {
  aiTranscribe: (opts: { audio: Buffer; mimeType: string; language?: string; feature: string }) => Promise<{
    text: string
    language: string
    durationSeconds: number
    provider: string
    model: string
  }>
}

export type TranscribeResult =
  | { ok: true; text: string; language: string; durationSeconds: number; provider: string; model: string }
  | { ok: false; reason: string; code: 'too_large' | 'empty' | 'unavailable' | 'failed' }

const NOT_CONFIGURED = /not configured|no audio|no .*provider|unavailable|disabled|off in settings/i

/** "hi-IN", "en", or empty/"auto" (provider detects). Anything else is dropped. */
export function normalizeLanguageHint(raw: unknown): string | undefined {
  const v = typeof raw === 'string' ? raw.trim() : ''
  if (!v || v.toLowerCase() === 'auto') return undefined
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(v) ? v : undefined
}

export async function transcribeAudio(opts: {
  audio: Buffer
  mimeType: string
  language?: string
  feature: string
}): Promise<TranscribeResult> {
  if (!opts.audio.length) return { ok: false, reason: 'The recording is empty', code: 'empty' }
  if (opts.audio.length > MAX_TRANSCRIBE_BYTES) {
    return { ok: false, reason: `The recording is over ${MAX_TRANSCRIBE_BYTES / 1024 / 1024} MB`, code: 'too_large' }
  }
  try {
    const { aiTranscribe } = (await import('@/lib/shared/ai-client')) as unknown as TranscribeFn
    const r = await aiTranscribe({ audio: opts.audio, mimeType: opts.mimeType, language: opts.language, feature: opts.feature })
    const text = (r.text || '').trim()
    if (!text) return { ok: false, reason: 'No speech was detected in the recording', code: 'empty' }
    return { ok: true, text, language: r.language, durationSeconds: r.durationSeconds, provider: r.provider, model: r.model }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[transcribe] failed', msg)
    if (NOT_CONFIGURED.test(msg)) {
      return {
        ok: false,
        reason: 'Audio transcription is not set up. Ask the store owner to turn on an audio provider in Settings, Providers.',
        code: 'unavailable',
      }
    }
    return { ok: false, reason: 'The recording could not be transcribed. Try again.', code: 'failed' }
  }
}
