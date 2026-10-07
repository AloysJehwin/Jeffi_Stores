'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchStreamUrl } from './stream-client'

// Video/audio playback with no download affordances. The <video>/<audio> src is a short-lived
// inline-disposition signed URL; controlsList + disablePictureInPicture strip the browser's own
// download / PiP / remote-playback controls. Never exposes a raw downloadable link.

export default function MediaViewer({ fileId, kind }: { fileId: string; kind: 'video' | 'audio' }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  const elRef = useRef<HTMLVideoElement & HTMLAudioElement>(null)

  useEffect(() => {
    let alive = true
    fetchStreamUrl(fileId)
      .then(r => alive && setUrl(r.url))
      .catch(() => alive && setErr(true))
    return () => {
      alive = false
    }
  }, [fileId])

  if (err) return <p className="text-sm text-red-400">Could not load this file.</p>
  if (!url) return <p className="text-sm text-neutral-500">Loading…</p>

  const common = {
    ref: elRef,
    src: url,
    controls: true,
    controlsList: 'nodownload noremoteplayback noplaybackrate',
    disablePictureInPicture: true,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    className: 'w-full rounded-md bg-black',
  } as const

  return kind === 'video' ? (
    <video {...common} playsInline />
  ) : (
    <audio {...common} />
  )
}
