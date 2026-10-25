'use client'

import { useState, useEffect, useRef } from 'react'
import BlurhashCanvas from './BlurhashCanvas'
import { fallBackToOriginal, srcSetFor } from '@/lib/shared/image-url'

interface ImgWithSkeletonProps {
  src: string
  alt: string
  className?: string
  /** Colour placeholder shown while loading. Falls back to the shimmer when absent or invalid. */
  blurhash?: string | null
  loading?: 'eager' | 'lazy'
  /** Rendered width; with it storefront photos get a resized srcset (lib/shared/image-url). */
  sizes?: string
}

export default function ImgWithSkeleton({ src, alt, className, blurhash, loading, sizes }: ImgWithSkeletonProps) {
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
    <div className="relative w-full h-full">
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
        sizes={srcSet ? sizes : undefined}
        srcSet={srcSet}
        src={src}
        alt={alt}
        loading={loading}
        className={`${className ?? ''} transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
        onError={e => {
          if (!fallBackToOriginal(e.currentTarget)) setLoaded(true)
        }}
      />
    </div>
  )
}
