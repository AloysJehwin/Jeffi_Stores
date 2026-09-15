'use client'

import { useState, useEffect, useRef } from 'react'
import BlurhashCanvas from '@/components/ui/BlurhashCanvas'

interface StoreImageProps {
  src: string
  alt: string
  className?: string
  wrapperClassName?: string
  blurhash?: string | null
  /** Set on the LCP image (first hero/product shot) so the browser fetches it immediately. */
  priority?: boolean
  sizes?: string
  onClick?: () => void
}

// Storefront image. Public CDN/S3 URLs only — never admin or signed URLs.
export default function StoreImage({
  src, alt, className, wrapperClassName, blurhash, priority, sizes, onClick,
}: StoreImageProps) {
  const [loaded, setLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    setLoaded(false)
  }, [src])

  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true)
    }
  })

  return (
    <div className={wrapperClassName ?? 'relative w-full h-full'} onClick={onClick}>
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
        sizes={sizes}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        decoding={priority ? 'sync' : 'async'}
        className={`${className ?? ''} transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </div>
  )
}
