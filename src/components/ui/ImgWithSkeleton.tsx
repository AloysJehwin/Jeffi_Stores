'use client'

import { useState, useEffect, useRef } from 'react'

interface ImgWithSkeletonProps {
  src: string
  alt: string
  className?: string
}

export default function ImgWithSkeleton({ src, alt, className }: ImgWithSkeletonProps) {
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
    <div className="relative w-full h-full">
      {!loaded && (
        <div className="absolute inset-0 overflow-hidden bg-gray-200 dark:bg-gray-700">
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)',
              animation: 'img-shimmer 1.4s infinite',
            }}
          />
        </div>
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={`${className ?? ''} transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </div>
  )
}
