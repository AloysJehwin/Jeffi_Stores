'use client'

import { createElement, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

// <model-viewer> is a web component (three.js inside), imported only when a 3D item is shown.
let loading: Promise<unknown> | null = null
const loadModelViewer = () => (loading ??= import('@google/model-viewer'))

export default function ModelViewer({
  src,
  iosSrc,
  poster,
  alt,
  ar = false,
  className = 'h-full w-full',
}: {
  src: string
  iosSrc?: string | null
  poster?: string | null
  alt?: string | null
  /** Offer "View in your space" (WebXR / Scene Viewer / Quick Look with the USDZ). */
  ar?: boolean
  className?: string
}) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let live = true
    loadModelViewer()
      .then(() => live && setReady(true))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  if (!ready)
    return (
      <div className={`relative flex items-center justify-center bg-surface-secondary ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {poster && <img src={poster} alt={alt ?? ''} className="absolute inset-0 h-full w-full object-contain opacity-60" />}
        <Loader2 className="relative h-6 w-6 animate-spin text-foreground-muted" />
      </div>
    )
  return createElement(
    'model-viewer',
    {
      src,
      'ios-src': iosSrc || undefined,
      poster: poster || undefined,
      alt: alt || '3D model',
      'camera-controls': '',
      'touch-action': 'pan-y',
      'shadow-intensity': '1',
      'auto-rotate': '',
      ...(ar ? { ar: '', 'ar-modes': 'webxr scene-viewer quick-look' } : {}),
      class: className,
      style: { width: '100%', height: '100%', background: 'transparent' },
    },
    ar
      ? createElement(
          'button',
          {
            slot: 'ar-button',
            type: 'button',
            className:
              'absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-4 py-2 text-xs font-semibold text-gray-900 shadow',
          },
          'View in your space'
        )
      : null
  )
}
