'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import AdminSelect from '@/components/admin/AdminSelect'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'

interface LocalImage {
  file?: File
  previewUrl: string
  fileName: string
  fileSize: number
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

interface GalleryImage {
  id: string
  image_url: string
  thumbnail_url: string
  file_name: string
  file_size: number
  width: number
  height: number
  custom_name: string | null
  category_id: string | null
  category_name: string | null
}

interface Category {
  id: string
  name: string
  slug: string
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
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>([])
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [selectedGalleryIds, setSelectedGalleryIds] = useState<string[]>([])
  const [gallerySearch, setGallerySearch] = useState('')
  const [galleryCategory, setGalleryCategory] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
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

  const openGallery = useCallback(async () => {
    setShowGallery(true)
    setSelectedGalleryIds([])
    setGallerySearch('')
    setGalleryCategory('')
    setGalleryLoading(true)
    try {
      const [galleryRes, catRes] = await Promise.all([
        fetch('/api/gallery?limit=100'),
        fetch('/api/categories'),
      ])
      const galleryData = await galleryRes.json()
      const catData = await catRes.json()
      setGalleryImages(galleryData.images || [])
      setCategories(catData.categories || [])
    } catch {
      setGalleryImages([])
    } finally {
      setGalleryLoading(false)
    }
  }, [])

  function handleUseGalleryImages() {
    const slotsLeft = maxImages - images.length
    if (slotsLeft <= 0) {
      setError(`You can only upload up to ${maxImages} images`)
      setShowGallery(false)
      setSelectedGalleryIds([])
      return
    }
    const toAdd = selectedGalleryIds.slice(0, slotsLeft)
    const existingIds = new Set(images.filter(i => i.id).map(i => i.id!))
    const newImgs: LocalImage[] = toAdd
      .filter(id => !existingIds.has(id))
      .map((id, idx) => {
        const gimg = galleryImages.find(g => g.id === id)!
        return {
          previewUrl: gimg.thumbnail_url || gimg.image_url,
          fileName: gimg.custom_name || gimg.file_name || 'gallery-image.png',
          fileSize: gimg.file_size,
          isPrimary: images.length === 0 && idx === 0,
          isGallery: true,
          id: gimg.id,
        }
      })
    const updated = [...images, ...newImgs]
    setImages(updated)
    notifyChange(updated)
    setShowGallery(false)
    setSelectedGalleryIds([])
    if (selectedGalleryIds.length > slotsLeft) {
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
          <p className="text-xs text-foreground-muted mb-2">Drag to reorder · First image is shown first on the product page</p>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/50 p-4">
          <div className="bg-surface-elevated rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-default">
              <h2 className="text-lg font-semibold text-foreground">Choose from Gallery</h2>
              <button
                type="button"
                onClick={() => { setShowGallery(false); setSelectedGalleryIds([]) }}
                className="text-foreground-muted hover:text-foreground transition-colors text-2xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="px-6 py-3 border-b border-border-default flex gap-2 items-center">
              <input
                type="text"
                placeholder="Search by name..."
                value={gallerySearch}
                onChange={e => setGallerySearch(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              />
              <div className="w-48 shrink-0">
                <AdminSelect
                  value={galleryCategory}
                  onChange={setGalleryCategory}
                  placeholder="All categories"
                  options={[
                    { value: '', label: 'All categories' },
                    ...categories.map(c => ({ value: c.id, label: c.name })),
                  ]}
                />
              </div>
            </div>

            <div className="overflow-y-auto flex-1 min-h-0 p-4 pr-3">
              {galleryLoading && (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!galleryLoading && galleryImages.length === 0 && (
                <p className="text-center text-foreground-secondary py-16">No images in gallery yet. Use the Chrome extension to add images.</p>
              )}
              {!galleryLoading && galleryImages.length > 0 && (() => {
                const q = gallerySearch.toLowerCase()
                const filtered = galleryImages.filter(g => {
                  const nameMatch = q ? (g.custom_name || '').toLowerCase().includes(q) : true
                  const catMatch = galleryCategory ? g.category_id === galleryCategory : true
                  return nameMatch && catMatch
                })
                return filtered.length === 0 ? (
                  <p className="text-center text-foreground-secondary py-16">No images match &ldquo;{gallerySearch}&rdquo;</p>
                ) : (
                  <div className="grid grid-cols-4 gap-3 w-full">
                    {filtered.map(gimg => {
                      const selIdx = selectedGalleryIds.indexOf(gimg.id)
                      const isSelected = selIdx !== -1
                      return (
                      <button
                        key={gimg.id}
                        type="button"
                        onClick={() => setSelectedGalleryIds(prev =>
                          prev.includes(gimg.id) ? prev.filter(id => id !== gimg.id) : [...prev, gimg.id]
                        )}
                        className={`relative rounded-lg overflow-hidden border-2 transition-colors text-left ${isSelected ? 'border-accent-500 ring-2 ring-accent-500' : 'border-border-default hover:border-accent-400'}`}
                      >
                        {isSelected && (
                          <div className="absolute top-1 right-1 bg-accent-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold z-10">
                            {selIdx + 1}
                          </div>
                        )}
                        <div className="aspect-square">
                          <ImgWithSkeleton src={gimg.thumbnail_url || gimg.image_url} alt={gimg.custom_name || gimg.file_name} className="w-full h-full object-cover" />
                        </div>
                        <div className="px-1.5 py-1 bg-surface-secondary">
                          <p className="text-xs text-foreground-secondary truncate">{gimg.custom_name || gimg.file_name}</p>
                          {gimg.category_name && (
                            <p className="text-xs text-accent-500 truncate">{gimg.category_name}</p>
                          )}
                        </div>
                      </button>
                    )})}
                  </div>
                )
              })()}
            </div>

            <div className="px-6 py-4 border-t border-border-default flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setShowGallery(false); setSelectedGalleryIds([]) }}
                className="px-4 py-2 text-sm font-semibold text-foreground-secondary hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUseGalleryImages}
                disabled={selectedGalleryIds.length === 0}
                className="px-4 py-2 bg-accent-500 hover:bg-accent-600 disabled:bg-surface-secondary disabled:text-foreground-muted text-white rounded-lg text-sm font-semibold transition-colors"
              >
                {selectedGalleryIds.length > 0 ? `Add ${selectedGalleryIds.length} Image${selectedGalleryIds.length > 1 ? 's' : ''}` : 'Add Images'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
