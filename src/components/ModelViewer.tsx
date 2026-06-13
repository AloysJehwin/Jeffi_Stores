'use client'

import { useEffect, useRef } from 'react'

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

export default function ModelViewer({
  src,
  alt = '',
  poster,
  className = '',
  autoRotate = true,
  cameraOrbit = '30deg 80deg 105%',
  exposure = 1,
}: ModelViewerProps) {
  const mounted = useRef(false)

  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    if (typeof window === 'undefined') return
    if (customElements.get('model-viewer')) return
    import('@google/model-viewer').catch(() => {/* swallow */})
  }, [])

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
      loading="lazy"
      reveal="auto"
      style={{ width: '100%', height: '100%', backgroundColor: 'transparent' }}
    />
  )
}
