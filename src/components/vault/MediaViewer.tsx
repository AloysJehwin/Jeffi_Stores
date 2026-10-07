'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchStreamUrl } from './stream-client'

// Video/audio playback with no download affordances. The src is a short-lived inline signed URL;
// it is re-signed transparently when it goes stale (seek) or fails mid-stream (expired range GET).

const STALE_MS = 70_000
const MAX_RETRIES = 3

export default function MediaViewer({ fileId, kind }: { fileId: string; kind: 'video' | 'audio' }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  const elRef = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const signedAt = useRef(0)
  const resume = useRef<{ time: number; play: boolean } | null>(null)
  const refreshing = useRef(false)
  const retries = useRef(0)
  const playing = useRef(false)

  const sign = useCallback(async () => {
    const r = await fetchStreamUrl(fileId)
    signedAt.current = Date.now()
    setUrl(r.url)
  }, [fileId])

  useEffect(() => {
    let alive = true
    fetchStreamUrl(fileId)
      .then(r => {
        if (!alive) return
        signedAt.current = Date.now()
        setUrl(r.url)
      })
      .catch(() => alive && setErr(true))
    return () => {
      alive = false
    }
  }, [fileId])

  const refresh = useCallback(
    async (time: number, play: boolean) => {
      if (refreshing.current) return
      if (retries.current >= MAX_RETRIES) return setErr(true)
      refreshing.current = true
      retries.current++
      resume.current = { time, play }
      try {
        await sign()
      } catch {
        setErr(true)
      } finally {
        refreshing.current = false
      }
    },
    [sign]
  )

  const onLoadedMetadata = () => {
    const el = elRef.current
    const r = resume.current
    if (!el || !r) return
    resume.current = null
    el.currentTime = r.time
    if (r.play) el.play().catch(() => {})
  }

  const onError = () => {
    const el = elRef.current
    if (el) refresh(el.currentTime, playing.current)
  }

  const onSeeking = () => {
    const el = elRef.current
    if (el && Date.now() - signedAt.current > STALE_MS) refresh(el.currentTime, playing.current)
  }

  if (err) return <p className="text-sm text-red-400">Could not load this file.</p>
  if (!url) return <p className="text-sm text-neutral-500">Loading…</p>

  const common = {
    ref: elRef,
    src: url,
    controls: true,
    controlsList: 'nodownload noremoteplayback noplaybackrate',
    disablePictureInPicture: true,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onLoadedMetadata,
    onError,
    onSeeking,
    onPlaying: () => {
      playing.current = true
      retries.current = 0
    },
    onPause: () => {
      if (!refreshing.current) playing.current = false
    },
    className: 'w-full rounded-md bg-black',
  } as const

  return kind === 'video' ? <video {...common} playsInline /> : <audio {...common} />
}
