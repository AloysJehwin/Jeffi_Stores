'use client'

import { useRef, useState } from 'react'
import { Images, Loader2, Upload, X } from 'lucide-react'
import AdminImage from '@/components/admin/AdminImage'
import GalleryPicker, { type GalleryImage, type GalleryVideo } from '@/components/admin/GalleryPicker'
import AiMediaButton from '@/components/admin/ai/AiMediaButton'
import AiVideoButton, { type AiVideoPick } from '@/components/admin/ai/AiVideoButton'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import { AI_SIZE_PRESETS, nearestVideoAspect, type AiImageFeature, type AiVideoFeature } from '@/lib/ai/media-features'
import { AI_FEATURE_SCOPES } from '@/lib/ai/scope-map'
import { IMAGE_MAX, IMAGE_TYPES, VIDEO_MAX, VIDEO_TYPES, galleryUpload, uploadGalleryVideo } from './media-upload'

/** A media slot: an image (also the poster when there is a video), an optional MP4/WebM, and the image's blurhash. */
export interface MediaValue {
  image: string | null
  video?: string | null
  blurhash?: string | null
}

export type MediaSize = 'square' | 'portrait' | 'story' | 'landscape' | 'wide' | 'hero'

interface Props {
  label: string
  hint?: string
  value: MediaValue
  onChange: (next: MediaValue) => void
  /** Size preset, or several: the first sets the preview shape and the video aspect; all are offered to AI. */
  size?: MediaSize | MediaSize[]
  /** AI image feature (billing and scope); default homepage_image. */
  aiFeature?: AiImageFeature
  /** AI video feature; default homepage_video. */
  videoFeature?: AiVideoFeature
  /** Offer video upload, the gallery's Videos tab and Generate video. */
  allowVideo?: boolean
  /** Area whose :write scope gates the controls; defaults from aiFeature. */
  scope?: string
  /** Replaces the default gallery upload for images (slot routes that save as they upload). */
  uploadImage?: (file: File) => Promise<{ url: string; blurhash?: string | null }>
  defaultPrompt?: string
  /** Logged on AI usage rows (slide id, offer id). */
  usageRef?: string
  disabled?: boolean
}

const btn =
  'control-md inline-flex items-center gap-1.5 border border-border-default text-xs font-semibold text-foreground hover:bg-surface-secondary disabled:opacity-50'

/**
 * One control for a card or banner media slot: preview (image, GIF or a muted looping video), Upload,
 * Gallery, Generate image, Generate video and Clear. A video keeps the slot image as its poster; when
 * the slot has none, the uploaded frame (or the AI reference image) becomes the image.
 */
export default function MediaField({
  label,
  hint,
  value,
  onChange,
  size = 'square',
  aiFeature = 'homepage_image',
  videoFeature = 'homepage_video',
  allowVideo = false,
  scope,
  uploadImage,
  defaultPrompt,
  usageRef,
  disabled,
}: Props) {
  const { showToast } = useToast()
  const area = scope ?? AI_FEATURE_SCOPES[aiFeature]
  const canWrite = useCanWrite(area)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'image' | 'video' | null>(null)
  const [picker, setPicker] = useState(false)

  const presets = (Array.isArray(size) ? size : [size]).map(k => AI_SIZE_PRESETS[k]).filter(Boolean)
  const primary = presets[0] ?? AI_SIZE_PRESETS.square
  const image = value.image || null
  const video = allowVideo ? value.video || null : null
  const editable = canWrite && !disabled

  const withVideo = (url: string, poster?: { url: string | null; blurhash?: string | null } | null): MediaValue =>
    image ? { ...value, video: url } : { image: poster?.url ?? null, blurhash: poster?.blurhash ?? null, video: url }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    if (allowVideo && file.type.startsWith('video/')) return uploadVideo(file)
    if (!IMAGE_TYPES.includes(file.type))
      return showToast(
        allowVideo ? 'Use a PNG, JPEG, WebP, GIF, MP4 or WebM file' : 'Use a PNG, JPEG, WebP or GIF image',
        'error'
      )
    if (file.size > IMAGE_MAX) return showToast('Image must be under 5 MB', 'error')
    setBusy('image')
    try {
      const r = uploadImage ? await uploadImage(file) : await galleryUpload(file, file.name)
      onChange({ ...value, image: r.url, blurhash: r.blurhash ?? null })
      showToast('Image updated', 'success')
    } catch (err) {
      showToast((err as Error).message || 'Upload failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function uploadVideo(file: File) {
    if (!VIDEO_TYPES.includes(file.type)) return showToast('Use an MP4 or WebM video', 'error')
    if (file.size > VIDEO_MAX) return showToast('Video must be under 50 MB', 'error')
    setBusy('video')
    try {
      const fallback = image && /^https?:\/\//i.test(image) ? { url: image, blurhash: value.blurhash } : null
      const { video: row, poster } = await uploadGalleryVideo(file, fallback)
      onChange(withVideo(row.url, poster))
      showToast('Video updated', 'success')
    } catch (err) {
      showToast((err as Error).message || 'Video upload failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  function pickImage(img?: GalleryImage) {
    setPicker(false)
    if (img) onChange({ ...value, image: img.image_url, blurhash: img.blurhash ?? null })
  }

  function pickVideo(v: GalleryVideo) {
    setPicker(false)
    onChange(withVideo(v.url, { url: v.thumbnail_url, blurhash: v.blurhash }))
  }

  function pickAiVideo(v: AiVideoPick) {
    onChange(withVideo(v.url, { url: v.posterUrl ?? null }))
  }

  const isGif = !!image && /\.gif(\?|$)/i.test(image)
  // The video route wants an absolute URL; site paths (/images/...) resolve against this origin.
  const referenceImage =
    image && /^https?:\/\//i.test(image)
      ? image
      : image?.startsWith('/') && typeof window !== 'undefined'
        ? new URL(image, window.location.origin).toString()
        : undefined
  const accept = [...IMAGE_TYPES, ...(allowVideo ? VIDEO_TYPES : [])].join(',')

  return (
    <div className="space-y-1.5">
      <div>
        <p className="text-xs font-medium text-foreground-secondary">{label}</p>
        {hint && <p className="text-[11px] text-foreground-muted">{hint}</p>}
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <div
          className="relative h-20 max-w-[12rem] shrink-0 overflow-hidden rounded-md border border-border-default bg-surface-secondary"
          style={{ aspectRatio: `${primary.width} / ${primary.height}` }}
        >
          {video ? (
            <video
              key={video}
              src={video}
              poster={image ?? undefined}
              muted
              loop
              autoPlay
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
            />
          ) : image ? (
            <AdminImage src={image} alt="" blurhash={value.blurhash} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-foreground-muted/60">
              Empty
            </div>
          )}
          {(video || isGif) && (
            <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1 text-[10px] font-semibold uppercase text-white">
              {video ? 'Video' : 'GIF'}
            </span>
          )}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <Loader2 className="h-4 w-4 animate-spin text-white" />
            </div>
          )}
        </div>
        {editable && (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept={accept} onChange={onFile} className="hidden" />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={!!busy} className={btn}>
              <Upload className="h-3.5 w-3.5" />
              {busy === 'video' ? 'Uploading video…' : busy === 'image' ? 'Uploading…' : 'Upload'}
            </button>
            <button type="button" onClick={() => setPicker(true)} disabled={!!busy} className={btn}>
              <Images className="h-3.5 w-3.5" />
              Gallery
            </button>
            <AiMediaButton
              feature={aiFeature}
              scope={area}
              sizes={presets.length ? presets : [AI_SIZE_PRESETS.square]}
              defaultPrompt={defaultPrompt}
              usageRef={usageRef}
              label="Generate image"
              onPick={img => onChange({ ...value, image: img.url, blurhash: img.blurhash ?? null })}
            />
            {allowVideo && (
              <AiVideoButton
                feature={videoFeature}
                scope={area}
                defaultPrompt={defaultPrompt}
                referenceImageUrl={referenceImage}
                defaultAspect={nearestVideoAspect(primary.width, primary.height)}
                usageRef={usageRef}
                label="Generate video"
                onPick={pickAiVideo}
              />
            )}
            {video && (
              <button
                type="button"
                onClick={() => onChange({ ...value, video: null })}
                disabled={!!busy}
                className="text-[11px] text-foreground-muted underline hover:text-red-500"
              >
                Remove video
              </button>
            )}
            {(image || video) && (
              <button
                type="button"
                onClick={() => onChange({ image: null, blurhash: null, video: allowVideo ? null : value.video })}
                disabled={!!busy}
                className={`${btn} hover:text-red-500`}
                title="Clear this slot"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </button>
            )}
          </div>
        )}
      </div>
      {video && (
        <p className="text-[11px] text-foreground-muted">
          Plays muted on a loop. The image is its poster and shows where video is off.
        </p>
      )}
      {picker && (
        <GalleryPicker
          mode="single"
          onConfirm={imgs => pickImage(imgs[0])}
          onPickVideo={allowVideo ? pickVideo : undefined}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  )
}
