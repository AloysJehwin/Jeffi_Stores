'use client'

import { useRef, useState } from 'react'
import { Images, Loader2, Upload } from 'lucide-react'
import GalleryPicker from '@/components/admin/GalleryPicker'
import AiVideoButton from '@/components/admin/ai/AiVideoButton'
import type { AiVideoAspect, AiVideoFeature } from '@/lib/ai/media-features'
import { VIDEO_MAX, VIDEO_TYPES, uploadGalleryVideo } from './media-upload'

/** AI video for the field. */
export interface VideoUrlAi {
  feature: AiVideoFeature
  /** Area whose :write scope gates the button; defaults from the feature. */
  scope?: string
  defaultPrompt?: string
  /** Image-to-video source (absolute URL). */
  imageUrl?: string
  aspect?: AiVideoAspect
  usageRef?: string
}

const sideBtn =
  'inline-flex shrink-0 items-center gap-1.5 self-stretch rounded-lg border border-border-default px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary disabled:opacity-50'

/** A video-URL field: paste a link, upload an MP4/WebM, pick a gallery video or generate one with AI. */
export default function VideoUrlInput({
  value,
  onChange,
  placeholder,
  className = '',
  ai,
  upload = true,
  gallery = true,
}: {
  value: string
  onChange: (url: string) => void
  placeholder?: string
  className?: string
  /** Adds an "AI video" button; hidden without the scope or the AI plan. */
  ai?: VideoUrlAi | false
  upload?: boolean
  gallery?: boolean
}) {
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)

  async function pick(f: File | undefined) {
    if (file.current) file.current.value = ''
    if (!f) return
    if (!VIDEO_TYPES.includes(f.type)) return setErr('Use an MP4 or WebM video')
    if (f.size > VIDEO_MAX) return setErr('Video must be under 50 MB')
    setBusy(true)
    setErr(null)
    try {
      onChange((await uploadGalleryVideo(f)).video.url)
    } catch (e) {
      setErr((e as Error).message || 'Video upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder ?? 'https://… or upload'}
          className={`${className} min-w-[10rem] flex-1`}
        />
        {upload && (
          <>
            <input
              ref={file}
              type="file"
              accept={VIDEO_TYPES.join(',')}
              hidden
              onChange={e => pick(e.target.files?.[0])}
            />
            <button type="button" onClick={() => file.current?.click()} disabled={busy} className={sideBtn}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {busy ? 'Uploading…' : 'Upload'}
            </button>
          </>
        )}
        {gallery && (
          <button type="button" onClick={() => setPicker(true)} disabled={busy} className={sideBtn}>
            <Images className="h-3.5 w-3.5" /> Gallery
          </button>
        )}
        {ai && (
          <AiVideoButton
            feature={ai.feature}
            scope={ai.scope}
            defaultPrompt={ai.defaultPrompt}
            defaultImageUrl={ai.imageUrl}
            defaultAspect={ai.aspect}
            usageRef={ai.usageRef}
            triggerClassName={sideBtn}
            onPick={v => onChange(v.url)}
          />
        )}
      </div>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      {picker && (
        <GalleryPicker
          mode="single"
          videosOnly
          onConfirm={() => setPicker(false)}
          onPickVideo={v => {
            setPicker(false)
            onChange(v.url)
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  )
}
