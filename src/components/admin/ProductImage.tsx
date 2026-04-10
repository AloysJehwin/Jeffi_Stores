'use client'

import { useEffect } from 'react'

interface ProductImageProps {
  thumbnailUrl?: string
  altText: string
}

export default function ProductImage({ thumbnailUrl, altText }: ProductImageProps) {
  useEffect(() => {
    if (thumbnailUrl) {
      console.log('ProductImage received URL:', thumbnailUrl)
    }
  }, [thumbnailUrl])

  if (!thumbnailUrl) {
    return (
      <div className="h-10 w-10 rounded bg-surface-secondary flex items-center justify-center text-foreground-muted text-xs">
        No Image
      </div>
    )
  }

  return (
    <>
      <img
        src={thumbnailUrl}
        alt={altText}
        className="h-10 w-10 rounded object-cover"
        onLoad={() => {
          console.log('Image loaded successfully:', thumbnailUrl)
        }}
        onError={(e) => {
          console.error('Image failed to load:', e.currentTarget.src)
          console.error('Trying to fetch directly to see error...')
          fetch(e.currentTarget.src)
            .then(res => console.log('Fetch status:', res.status, res.statusText))
            .catch(err => console.error('Fetch error:', err))
          e.currentTarget.style.display = 'none'
          const fallback = e.currentTarget.nextElementSibling as HTMLElement
          if (fallback) fallback.classList.remove('hidden')
        }}
      />
      <div className="h-10 w-10 rounded bg-surface-secondary flex items-center justify-center text-foreground-muted text-xs hidden">
        !
      </div>
    </>
  )
}
