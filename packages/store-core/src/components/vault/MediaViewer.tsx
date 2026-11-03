'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchStreamUrl } from './stream-client'

// Video/audio playback with no download affordances. The src is a short-lived inline signed URL;
// it is re-signed transparently when it goes stale (seek) or fails mid-stream (expired range GET).
// Native fullscreen is off: ContentGuard fullscreens its own container so the watermark stays on top.
//
// True screenshot/recording protection (OS captures show a black frame) needs EME DRM: package the
// video as CENC/CBCS (DASH/HLS), play it through MSE (e.g. Shaka Player), and call
// navigator.requestMediaKeySystemAccess('com.widevine.alpha' | 'com.apple.fps' | 'com.microsoft.playready')
// with a licence server URL — that would replace the plain signed `src` below. Not implemented.

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

  // iOS Safari ignores controlsList and can still enter its own player fullscreen; bounce out of it.
  useEffect(() => {
    const el = elRef.current as (HTMLVideoElement & { webkitExitFullscreen?: () => void }) | null
    if (!el || kind !== 'video') return
    const exit = () => el.webkitExitFullscreen?.()
    el.addEventListener('webkitbeginfullscreen', exit)
    return () => el.removeEventListener('webkitbeginfullscreen', exit)
  }, [kind, url])

  if (err) return <p className="text-sm text-red-400">Could not load this file.</p>
  if (!url) return <p className="text-sm text-neutral-500">Loading…</p>

  const common = {
    ref: elRef,
    src: url,
    controls: true,
    controlsList: 'nodownload nofullscreen noremoteplayback noplaybackrate',
    disablePictureInPicture: true,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onDoubleClick: (e: React.MouseEvent) => e.preventDefault(),
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
