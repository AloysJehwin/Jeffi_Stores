'use client'

import { useState } from 'react'

interface ImgWithSkeletonProps {
  src: string
  alt: string
  className?: string
}

export default function ImgWithSkeleton({ src, alt, className }: ImgWithSkeletonProps) {
  const [loaded, setLoaded] = useState(false)
  const [currentSrc, setCurrentSrc] = useState(src)

  if (currentSrc !== src) {
    setCurrentSrc(src)
    setLoaded(false)
  }

  return (
    <div className="relative w-full h-full">
      <style>{`
        @keyframes img-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
      {!loaded && (
        <div className="absolute inset-0 overflow-hidden bg-gray-200 dark:bg-gray-700">
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)',
              animation: 'img-shimmer 1.4s infinite',
              backgroundSize: '200% 100%',
            }}
          />
        </div>
      )}
      <img
        src={src}
        alt={alt}
        className={`${className ?? ''} transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
      />
    </div>
  )
}
