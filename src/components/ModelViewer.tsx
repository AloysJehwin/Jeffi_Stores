'use client'

import { useEffect, useState } from 'react'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': any
    }
  }
}

interface ModelViewerProps {
  src: string
  alt?: string
  poster?: string
  className?: string
  autoRotate?: boolean
  cameraOrbit?: string
  exposure?: number
}

let loaderPromise: Promise<void> | null = null

function loadModelViewer(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (customElements.get('model-viewer')) return Promise.resolve()
  if (loaderPromise) return loaderPromise
  loaderPromise = import('@google/model-viewer').then(() => undefined).catch(() => {
    loaderPromise = null
  })
  return loaderPromise
}

export default function ModelViewer({
  src,
  alt = '',
  poster,
  className = '',
  autoRotate = true,
  cameraOrbit = '30deg 80deg 105%',
  exposure = 1,
}: ModelViewerProps) {
  const [ready, setReady] = useState(false)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadModelViewer().then(() => {
      if (cancelled) return
      if (typeof window !== 'undefined' && customElements.get('model-viewer')) {
        setReady(true)
      } else {
        setErrored(true)
      }
    })
    return () => { cancelled = true }
  }, [])

  if (errored) {
    return poster ? (
      <img src={poster} alt={alt} className={className} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    ) : null
  }

  if (!ready) {
    return (
      <div className={className} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {poster ? (
          <img src={poster} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: 0.5 }} />
        ) : (
          <div style={{ width: 48, height: 48, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  return (
    <model-viewer
      src={src}
      alt={alt}
      poster={poster}
      class={className}
      camera-controls=""
      auto-rotate={autoRotate ? '' : undefined}
      auto-rotate-delay="0"
      rotation-per-second="20deg"
      camera-orbit={cameraOrbit}
      interaction-prompt="none"
      shadow-intensity="1"
      exposure={exposure}
      loading="eager"
      reveal="auto"
      style={{ width: '100%', height: '100%', backgroundColor: 'transparent' }}
    />
  )
}
