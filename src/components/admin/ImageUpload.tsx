'use client'

import { useState, useEffect } from 'react'

interface LocalImage {
  file?: File
  previewUrl: string
  fileName: string
  fileSize: number
  isPrimary?: boolean
  isExisting?: boolean
  id?: string
}

interface ExistingImage {
  id: string
  image_url: string
  thumbnail_url: string
  file_name: string
  file_size: number
  is_primary: boolean
}

interface ImageUploadProps {
  productId: string
  maxImages?: number
  existingImages?: ExistingImage[]
  onImagesChange?: (files: File[], existingImagesToKeep: ExistingImage[]) => void
}

export default function ImageUpload({
  productId,
  maxImages = 5,
  existingImages = [],
  onImagesChange,
}: ImageUploadProps) {
  const [images, setImages] = useState<LocalImage[]>([])
  const [error, setError] = useState<string | null>(null)

  // Load existing images on mount
  useEffect(() => {
    if (existingImages && existingImages.length > 0) {
      const existingImagesData: LocalImage[] = existingImages.map(img => ({
        id: img.id,
        previewUrl: img.thumbnail_url,
        fileName: img.file_name,
        fileSize: img.file_size,
        isPrimary: img.is_primary,
        isExisting: true,
      }))
      setImages(existingImagesData)
    }
  }, [existingImages])

  // Cleanup blob URLs when component unmounts (only for new uploads, not existing images)
  useEffect(() => {
    return () => {
      images.forEach(img => {
        if (!img.isExisting && img.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(img.previewUrl)
        }
      })
    }
  }, [images])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])

    if (files.length === 0) return

    if (images.length + files.length > maxImages) {
      setError(`You can only upload up to ${maxImages} images`)
      return
    }

    setError(null)

    // Create local preview URLs
    const newImages: LocalImage[] = files.map((file, index) => ({
      file,
      previewUrl: URL.createObjectURL(file),
      fileName: file.name,
      fileSize: file.size,
      isPrimary: images.length === 0 && index === 0, // First image is primary
      isExisting: false,
    }))

    const updatedImages = [...images, ...newImages]
    setImages(updatedImages)

    // Pass new File objects and existing images to keep (with updated isPrimary)
    const newFiles = updatedImages.filter(img => img.file).map(img => img.file!)
    const existingToKeep = updatedImages.filter(img => img.isExisting && img.id).map(img => {
      const original = existingImages.find(ei => ei.id === img.id)!
      return {
        ...original,
        is_primary: img.isPrimary || false
      }
    }).filter(Boolean)
    onImagesChange?.(newFiles, existingToKeep)

    e.target.value = ''
  }

  function handleRemoveImage(index: number) {
    const imageToRemove = images[index]

    // Revoke the blob URL to free memory (only for new uploads)
    if (!imageToRemove.isExisting && imageToRemove.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(imageToRemove.previewUrl)
    }

    const newImages = images.filter((_, i) => i !== index)

    // If we removed the primary image and there are still images, make the first one primary
    if (newImages.length > 0 && !newImages.some(img => img.isPrimary)) {
      newImages[0].isPrimary = true
    }

    setImages(newImages)

    // Pass new File objects and existing images to keep (with updated isPrimary)
    const newFiles = newImages.filter(img => img.file).map(img => img.file!)
    const existingToKeep = newImages.filter(img => img.isExisting && img.id).map(img => {
      const original = existingImages.find(ei => ei.id === img.id)!
      return {
        ...original,
        is_primary: img.isPrimary || false
      }
    }).filter(Boolean)
    onImagesChange?.(newFiles, existingToKeep)
  }

  function handleSetPrimary(index: number) {
    const newImages = images.map((img, i) => ({
      ...img,
      isPrimary: i === index,
    }))
    setImages(newImages)

    // Pass new File objects and existing images to keep (with updated isPrimary)
    const newFiles = newImages.filter(img => img.file).map(img => img.file!)
    const existingToKeep = newImages.filter(img => img.isExisting && img.id).map(img => {
      const original = existingImages.find(ei => ei.id === img.id)!
      return {
        ...original,
        is_primary: img.isPrimary || false
      }
    }).filter(Boolean)
    onImagesChange?.(newFiles, existingToKeep)
  }

  const canUploadMore = images.length < maxImages

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-foreground-secondary">Product Images</h3>
          <p className="text-xs text-foreground-muted mt-1">
            Select up to {maxImages} images. They will be uploaded when you create the product.
          </p>
        </div>
        {canUploadMore && (
          <label className="cursor-pointer">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            <span className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-colors inline-block">
              Select Images
            </span>
          </label>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {images.map((image, index) => (
            <div key={index} className="relative group">
              <div className="aspect-square rounded-lg overflow-hidden border-2 border-border-default hover:border-accent-500 transition-colors">
                <img
                  src={image.previewUrl}
                  alt={image.fileName}
                  className="w-full h-full object-cover"
                />
              </div>

              {image.isPrimary && (
                <div className="absolute top-2 left-2 bg-accent-500 text-white text-xs px-2 py-1 rounded">
                  Primary
                </div>
              )}

              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-opacity rounded-lg flex items-center justify-center gap-2">
                {!image.isPrimary && (
                  <button
                    type="button"
                    onClick={() => handleSetPrimary(index)}
                    className="opacity-0 group-hover:opacity-100 px-3 py-1 bg-white text-foreground-secondary rounded text-xs font-semibold hover:bg-surface-secondary transition-all"
                  >
                    Set Primary
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleRemoveImage(index)}
                  className="opacity-0 group-hover:opacity-100 px-3 py-1 bg-red-600 text-white rounded text-xs font-semibold hover:bg-red-700 transition-all"
                >
                  Remove
                </button>
              </div>

              <p className="text-xs text-foreground-secondary mt-1 truncate">{image.fileName}</p>
            </div>
          ))}
        </div>
      )}

      {images.length === 0 && (
        <div className="border-2 border-dashed border-border-secondary rounded-lg p-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-foreground-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <p className="mt-2 text-sm text-foreground-secondary">No images selected yet</p>
        </div>
      )}
    </div>
  )
}
