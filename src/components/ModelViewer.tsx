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

const MODEL_VIEWER_CDN = 'https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js'

let loaderPromise: Promise<void> | null = null

function loadModelViewer(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (customElements.get('model-viewer')) return Promise.resolve()
  if (loaderPromise) return loaderPromise

  loaderPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-model-viewer-loader]`)
    if (existing) {
      if (customElements.get('model-viewer')) return resolve()
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('script load failed')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.type = 'module'
    script.src = MODEL_VIEWER_CDN
    script.dataset.modelViewerLoader = '1'
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('script load failed')), { once: true })
    document.head.appendChild(script)
  }).catch(() => {
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
    let attempts = 0
    const tick = () => {
      if (cancelled) return
      if (typeof window !== 'undefined' && customElements.get('model-viewer')) {
        setReady(true)
        return
      }
      attempts += 1
      if (attempts > 100) {
        setErrored(true)
        return
      }
      setTimeout(tick, 50)
    }
    loadModelViewer().then(() => {
      if (cancelled) return
      tick()
    })
    return () => { cancelled = true }
  }, [])

  if (errored) {
    return poster ? (
      <img src={poster} alt={alt} className={className} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    ) : (
      <div className={className} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px dashed rgba(255,255,255,0.3)', color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
        Model failed to load
      </div>
    )
  }

  if (!ready) {
    return (
      <div className={className} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px dashed rgba(255,255,255,0.15)' }}>
        {poster ? (
          <img src={poster} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: 0.5 }} />
        ) : (
          <div style={{ width: 48, height: 48, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: 'white', borderRadius: '50%', animation: 'mvspin 1s linear infinite' }} />
        )}
        <style>{`@keyframes mvspin { to { transform: rotate(360deg); } }`}</style>
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
