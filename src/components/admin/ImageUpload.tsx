'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'
import GalleryPicker, { type GalleryImage } from '@/components/admin/GalleryPicker'

interface LocalImage {
  file?: File
  previewUrl: string
  fileName: string
  fileSize?: number
  isPrimary?: boolean
  isExisting?: boolean
  isGallery?: boolean
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
  onImagesChange?: (files: File[], existingImagesToKeep: ExistingImage[], galleryImages: { id: string; isPrimary: boolean }[], orderedKeys: string[]) => void
}

export default function ImageUpload({
  maxImages = 5,
  existingImages = [],
  onImagesChange,
}: Omit<ImageUploadProps, 'productId'> & { productId?: string }) {
  const [images, setImages] = useState<LocalImage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showGallery, setShowGallery] = useState(false)
  const dragIndex = useRef<number | null>(null)
  const dragOverIndex = useRef<number | null>(null)

  useEffect(() => {
    if (existingImages && existingImages.length > 0) {
      setImages(existingImages.map(img => ({
        id: img.id,
        previewUrl: img.thumbnail_url,
        fileName: img.file_name,
        fileSize: img.file_size,
        isPrimary: img.is_primary,
        isExisting: true,
      })))
    }
  }, [existingImages])

  useEffect(() => {
    return () => {
      images.forEach(img => {
        if (!img.isExisting && img.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(img.previewUrl)
        }
      })
    }
  }, [images])

  function notifyChange(updatedImages: LocalImage[]) {
    const newFiles = updatedImages.filter(img => img.file && !img.isGallery).map(img => img.file!)
    const galleryImgs = updatedImages
      .filter(img => img.isGallery && img.id)
      .map(img => ({ id: img.id!, isPrimary: img.isPrimary || false }))
    const existingToKeep = updatedImages
      .filter(img => img.isExisting && img.id)
      .map(img => {
        const original = existingImages.find(ei => ei.id === img.id)!
        return { ...original, is_primary: img.isPrimary || false }
      })
      .filter(Boolean)

    let fileIndex = 0
    const orderedKeys = updatedImages.map(img => {
      if (img.isExisting && img.id) return `existing:${img.id}`
      if (img.isGallery && img.id) return `gallery:${img.id}`
      return `file:${fileIndex++}`
    })

    onImagesChange?.(newFiles, existingToKeep, galleryImgs, orderedKeys)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    if (images.length + files.length > maxImages) {
      setError(`You can only upload up to ${maxImages} images`)
      return
    }
    setError(null)
    const newImages: LocalImage[] = files.map((file, index) => ({
      file,
      previewUrl: URL.createObjectURL(file),
      fileName: file.name,
      fileSize: file.size,
      isPrimary: images.length === 0 && index === 0,
      isExisting: false,
    }))
    const updated = [...images, ...newImages]
    setImages(updated)
    notifyChange(updated)
    e.target.value = ''
  }

  function handleRemoveImage(index: number) {
    const img = images[index]
    if (!img.isExisting && img.previewUrl.startsWith('blob:')) URL.revokeObjectURL(img.previewUrl)
    const updated = images.filter((_, i) => i !== index)
    if (updated.length > 0 && !updated.some(i => i.isPrimary)) updated[0].isPrimary = true
    setImages(updated)
    notifyChange(updated)
  }

  function handleSetPrimary(index: number) {
    const updated = images.map((img, i) => ({ ...img, isPrimary: i === index }))
    setImages(updated)
    notifyChange(updated)
  }

  function handleDragStart(index: number) {
    dragIndex.current = index
  }

  function handleDragEnter(index: number) {
    dragOverIndex.current = index
  }

  function handleDragEnd() {
    const from = dragIndex.current
    const to = dragOverIndex.current
    if (from === null || to === null || from === to) {
      dragIndex.current = null
      dragOverIndex.current = null
      return
    }
    const updated = [...images]
    const [moved] = updated.splice(from, 1)
    updated.splice(to, 0, moved)
    dragIndex.current = null
    dragOverIndex.current = null
    setImages(updated)
    notifyChange(updated)
  }

  function moveImage(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= images.length || to >= images.length) return
    const updated = [...images]
    const [moved] = updated.splice(from, 1)
    updated.splice(to, 0, moved)
    setImages(updated)
    notifyChange(updated)
  }

  const openGallery = useCallback(() => { setShowGallery(true) }, [])

  function handleUseGalleryImages(picked: GalleryImage[]) {
    setShowGallery(false)
    const slotsLeft = maxImages - images.length
    if (slotsLeft <= 0) {
      setError(`You can only upload up to ${maxImages} images`)
      return
    }
    const existingIds = new Set(images.filter(i => i.id).map(i => i.id!))
    const toAdd = picked.filter(g => !existingIds.has(g.id)).slice(0, slotsLeft)
    const newImgs: LocalImage[] = toAdd.map((gimg, idx) => ({
      previewUrl: gimg.thumbnail_url || gimg.image_url,
      fileName: gimg.custom_name || gimg.file_name || 'gallery-image.png',
      fileSize: gimg.file_size ?? undefined,
      isPrimary: images.length === 0 && idx === 0,
      isGallery: true,
      id: gimg.id,
    }))
    const updated = [...images, ...newImgs]
    setImages(updated)
    notifyChange(updated)
    if (picked.length > slotsLeft) {
      setError(`Only ${slotsLeft} slot(s) remaining. Added first ${slotsLeft} image(s).`)
    } else {
      setError(null)
    }
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
          <div className="flex gap-2">
            <button
              type="button"
              onClick={openGallery}
              className="px-4 py-2 bg-surface-secondary hover:bg-surface-elevated border border-border-default text-foreground-secondary rounded-lg text-sm font-semibold transition-colors"
            >
              Choose from Gallery
            </button>
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
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {images.length > 0 && (
        <div>
          <p className="text-xs text-foreground-muted mb-2">
            <span className="hidden sm:inline">Drag</span><span className="sm:hidden">Use ◀ ▶</span> to reorder · First image is shown first on the product page
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {images.map((image, index) => (
              <div
                key={index}
                className="relative group cursor-grab active:cursor-grabbing"
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragEnter={() => handleDragEnter(index)}
                onDragEnd={handleDragEnd}
                onDragOver={e => e.preventDefault()}
              >
                <div className="aspect-square rounded-lg overflow-hidden border-2 border-border-default hover:border-accent-500 transition-colors select-none">
                  <ImgWithSkeleton src={image.previewUrl} alt={image.fileName} className="w-full h-full object-cover pointer-events-none" />
                </div>
                {image.isPrimary && (
                  <div className="absolute top-2 left-2 bg-accent-500 text-white text-xs px-2 py-1 rounded">Primary</div>
                )}
                <div className="absolute top-2 right-2 bg-black/50 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
                  {index + 1}
                </div>
                {images.length > 1 && (
                  <div className="absolute inset-x-2 bottom-2 flex justify-between sm:opacity-0 sm:group-hover:opacity-100 sm:transition-opacity">
                    <button
                      type="button"
                      onClick={() => moveImage(index, index - 1)}
                      disabled={index === 0}
                      className="w-7 h-7 flex items-center justify-center rounded-full bg-black/60 text-white text-xs leading-none disabled:opacity-30"
                      title="Move left"
                      aria-label="Move image left"
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      onClick={() => moveImage(index, index + 1)}
                      disabled={index === images.length - 1}
                      className="w-7 h-7 flex items-center justify-center rounded-full bg-black/60 text-white text-xs leading-none disabled:opacity-30"
                      title="Move right"
                      aria-label="Move image right"
                    >
                      ▶
                    </button>
                  </div>
                )}
                <div className="absolute inset-x-0 top-8 bottom-12 sm:inset-0 bg-black bg-opacity-40 sm:bg-opacity-0 sm:group-hover:bg-opacity-40 transition-opacity rounded-lg flex items-center justify-center gap-2">
                  {!image.isPrimary && (
                    <button
                      type="button"
                      onClick={() => handleSetPrimary(index)}
                      className="px-3 py-1 bg-white text-foreground-secondary rounded text-xs font-semibold hover:bg-surface-secondary transition-all sm:opacity-0 sm:group-hover:opacity-100"
                    >
                      Set Primary
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(index)}
                    className="px-3 py-1 bg-red-600 text-white rounded text-xs font-semibold hover:bg-red-700 transition-all sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    Remove
                  </button>
                </div>
                <p className="text-xs text-foreground-secondary mt-1 truncate">{image.fileName}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {images.length === 0 && (
        <div className="border-2 border-dashed border-border-secondary rounded-lg p-12 text-center">
          <svg className="mx-auto h-12 w-12 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="mt-2 text-sm text-foreground-secondary">No images selected yet</p>
        </div>
      )}

      {showGallery && (
        <GalleryPicker
          mode="multi"
          maxSelect={Math.max(0, maxImages - images.length)}
          onClose={() => setShowGallery(false)}
          onConfirm={handleUseGalleryImages}
        />
      )}
    </div>
  )
}
