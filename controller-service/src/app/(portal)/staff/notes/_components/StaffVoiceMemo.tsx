'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  onRecorded: (blob: Blob | null, durationSeconds: number) => void
}

// Plain audio capture (no transcription): MediaRecorder -> Blob, attached as an audio note.
export default function StaffVoiceMemo({ onRecorded }: Props) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
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

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current)
    recRef.current?.stop()
    setRecording(false)
  }

  function discard() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setSeconds(0)
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
                ? `Recorded ${seconds}s`
                : 'Optional. Saved as an audio attachment.'}
          </p>
        </div>
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
          <button type="button" onClick={discard} className="text-xs text-red-600 hover:underline">
            Discard
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  )
}
