'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  onRecorded: (blob: Blob | null, durationSeconds: number) => void
  /** Called with the transcript of a finished recording; the audio is kept either way. */
  onTranscript?: (text: string) => void
}

// Optional spoken-language hints for Indian languages; Auto lets the provider detect.
const LANGUAGES: [string, string][] = [
  ['', 'Auto'],
  ['en-IN', 'English'],
  ['hi-IN', 'Hindi'],
  ['ta-IN', 'Tamil'],
  ['te-IN', 'Telugu'],
  ['kn-IN', 'Kannada'],
  ['ml-IN', 'Malayalam'],
  ['mr-IN', 'Marathi'],
  ['bn-IN', 'Bengali'],
  ['gu-IN', 'Gujarati'],
  ['pa-IN', 'Punjabi'],
]

// MediaRecorder -> Blob, attached as an audio note and transcribed through /api/staff/notes/transcribe.
export default function StaffVoiceMemo({ onRecorded, onTranscript }: Props) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [language, setLanguage] = useState('')
  const [transcribing, setTranscribing] = useState(false)
  const [transcribed, setTranscribed] = useState(false)
  const blobRef = useRef<{ blob: Blob; duration: number } | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAt = useRef(0)

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    },
    [previewUrl]
  )

  async function start() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(
        m => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)
      )
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      rec.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        const dur = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000))
        const url = URL.createObjectURL(blob)
        setPreviewUrl(url)
        onRecorded(blob, dur)
        blobRef.current = { blob, duration: dur }
        if (onTranscript) void transcribe()
      }
      rec.start()
      recRef.current = rec
      startedAt.current = Date.now()
      setSeconds(0)
      setRecording(true)
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
    } catch {
      setError('Microphone access was denied or is unavailable.')
    }
  }

  async function transcribe() {
    const rec = blobRef.current
    if (!rec || !onTranscript) return
    setTranscribing(true)
    setTranscribed(false)
    setError('')
    try {
      const fd = new FormData()
      const ext = rec.blob.type.includes('mp4') ? 'm4a' : rec.blob.type.includes('ogg') ? 'ogg' : 'webm'
      fd.set('file', new File([rec.blob], `voice-memo.${ext}`, { type: rec.blob.type || 'audio/webm' }))
      fd.set('durationSeconds', String(rec.duration))
      if (language) fd.set('language', language)
      const res = await fetch('/api/staff/notes/transcribe', { method: 'POST', body: fd, credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.text) {
        setError(data.error || 'The recording could not be transcribed.')
        return
      }
      onTranscript(String(data.text))
      setTranscribed(true)
    } catch {
      setError('Network error. The recording was kept; you can try the transcript again.')
    } finally {
      setTranscribing(false)
    }
  }

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current)
    recRef.current?.stop()
    setRecording(false)
  }

  function discard() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setSeconds(0)
    setError('')
    setTranscribed(false)
    blobRef.current = null
    onRecorded(null, 0)
  }

  const canRecord = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices

  if (!canRecord) return null

  return (
    <div className="rounded-xl border border-border-default p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Voice memo</p>
          <p className="text-[11px] text-foreground-muted">
            {recording
              ? `Recording… ${seconds}s`
              : previewUrl
                ? transcribing
                  ? `Recorded ${seconds}s. Transcribing…`
                  : transcribed
                    ? `Recorded ${seconds}s. Transcript added to the note.`
                    : `Recorded ${seconds}s`
                : 'Optional. Saved as an audio attachment.'}
          </p>
        </div>
        {!previewUrl && onTranscript && (
          <select
            aria-label="Spoken language"
            value={language}
            onChange={e => setLanguage(e.target.value)}
            disabled={recording}
            className="text-xs rounded-lg border border-border-secondary bg-surface-secondary px-2 py-1.5"
          >
            {LANGUAGES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        )}
        {!previewUrl && (
          <button
            type="button"
            onClick={recording ? stop : start}
            className={`px-4 py-2 rounded-xl text-sm font-semibold ${recording ? 'bg-red-600 text-white' : 'bg-surface-secondary text-foreground border border-border-secondary'}`}
          >
            {recording ? 'Stop' : 'Record'}
          </button>
        )}
      </div>
      {previewUrl && (
        <div className="mt-3 flex items-center gap-3">
          <audio controls src={previewUrl} className="h-9 flex-1" />
          {onTranscript && !transcribing && !transcribed && error && (
            <button type="button" onClick={() => void transcribe()} className="text-xs text-foreground hover:underline">
              Retry transcript
            </button>
          )}
          <button type="button" onClick={discard} className="text-xs text-red-600 hover:underline">
            Discard
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  )
}
