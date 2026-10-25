'use client'

import { useState, useEffect, useRef, type CSSProperties } from 'react'
import BlurhashCanvas from '@/components/ui/BlurhashCanvas'
import { fallBackToOriginal, srcSetFor } from '@/lib/shared/image-url'

interface StoreImageProps {
  src: string
  alt: string
  className?: string
  wrapperClassName?: string
  imgStyle?: CSSProperties
  blurhash?: string | null
  /** Set on the LCP image (first hero/product shot) so the browser fetches it immediately. */
  priority?: boolean
  /** Rendered width; with it the image gets a resized srcset (lib/shared/image-url). */
  sizes?: string
  onClick?: () => void
}

// Storefront image. Public CDN/S3 URLs only — never admin or signed URLs.
export default function StoreImage({
  src,
  alt,
  className,
  wrapperClassName,
  imgStyle,
  blurhash,
  priority,
  sizes,
  onClick,
}: StoreImageProps) {
  const [loaded, setLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const srcSet = sizes ? srcSetFor(src, sizes) : undefined

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
      {!loaded &&
        (blurhash ? (
          <BlurhashCanvas hash={blurhash} />
        ) : (
          <div className="absolute inset-0 overflow-hidden bg-gray-200 dark:bg-gray-700">
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)',
                animation: 'img-shimmer 1.4s infinite',
              }}
            />
          </div>
        ))}
      <img
        ref={imgRef}
        // sizes/srcset before src, so a client render doesn't start fetching the original first.
        sizes={sizes}
        srcSet={srcSet}
        src={src}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        decoding={priority ? 'sync' : 'async'}
        style={imgStyle}
        className={`${className ?? ''} transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
        onError={e => {
          if (!fallBackToOriginal(e.currentTarget)) setLoaded(true)
        }}
      />
    </div>
  )
}
