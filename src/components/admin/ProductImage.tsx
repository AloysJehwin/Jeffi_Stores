'use client'

import { Package } from 'lucide-react'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'

interface ProductImageProps {
  thumbnailUrl?: string
  altText: string
}

export default function ProductImage({ thumbnailUrl, altText }: ProductImageProps) {
  if (!thumbnailUrl) {
    return (
      <div className="h-10 w-10 rounded bg-surface-secondary flex items-center justify-center text-foreground-muted">
        <Package className="w-4 h-4" />
      </div>
    )
  }

  return (
    <div className="h-10 w-10 rounded overflow-hidden">
      <ImgWithSkeleton src={thumbnailUrl} alt={altText} className="w-full h-full object-cover" />
    </div>
  )
}
