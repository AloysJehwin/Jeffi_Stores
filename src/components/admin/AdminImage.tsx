'use client'

import { useState, useEffect, useRef } from 'react'
import { ImageOff } from 'lucide-react'
import BlurhashCanvas from '@/components/ui/BlurhashCanvas'

interface AdminImageProps {
  src: string | null | undefined
  alt: string
  className?: string
  wrapperClassName?: string
  blurhash?: string | null
  /** Icon shown when src is missing or the image fails, instead of a broken-image glyph. */
  fallback?: React.ReactNode
}

// Admin-panel image. Kept separate from the storefront component because admin surfaces render
// URLs behind authorization and must never be reused on public pages.
export default function AdminImage({
  src, alt, className, wrapperClassName, blurhash, fallback,
}: AdminImageProps) {
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    setLoaded(false)
    setErrored(false)
  }, [src])

  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true)
    }
  })

  if (!src || errored) {
    return (
      <div className={`${wrapperClassName ?? 'relative w-full h-full'} flex items-center justify-center bg-surface-secondary`}>
        {fallback ?? <ImageOff className="w-4 h-4 text-foreground-muted" aria-hidden="true" />}
        <span className="sr-only">{alt}</span>
      </div>
    )
  }

  return (
    <div className={wrapperClassName ?? 'relative w-full h-full'}>
      {!loaded && (
        blurhash
          ? <BlurhashCanvas hash={blurhash} />
          : (
            <div className="absolute inset-0 overflow-hidden bg-gray-200 dark:bg-gray-700">
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)',
                  animation: 'img-shimmer 1.4s infinite',
                }}
              />
            </div>
          )
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={`${className ?? ''} transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
        onError={() => { setErrored(true); setLoaded(true) }}
      />
    </div>
  )
}
