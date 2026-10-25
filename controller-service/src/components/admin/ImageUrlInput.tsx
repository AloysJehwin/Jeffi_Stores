'use client'

import { useRef, useState } from 'react'
import { Images, Loader2, Upload } from 'lucide-react'
import GalleryPicker from '@/components/admin/GalleryPicker'
import AiMediaButton from '@/components/admin/ai/AiMediaButton'
import { AI_SIZE_PRESETS, type AiImageFeature } from '@/lib/ai/media-features'

// An image-URL field with an Upload button: paste a link or upload a file (→ CDN URL in the field).
// Optional Gallery pick and AI image generation sit beside it.

// Raw bytes rather than multipart: the server checks it received every byte (lib/shared/form-file).
export async function uploadImage(file: File, endpoint = '/api/admin/uploads/image'): Promise<string> {
  const r = await fetch(endpoint, {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.url) throw new Error(d.error || 'Upload failed')
  return d.url as string
}

/** AI image generation for the field: feature (billing + scope) and the AI_SIZE_PRESETS keys to offer. */
export interface ImageUrlAi {
  feature: AiImageFeature
  /** First is pre-selected; defaults to square. */
  size?: string | string[]
  /** Area whose :write scope gates the button; defaults from the feature. */
  scope?: string
  defaultPrompt?: string
  referenceImageUrl?: string
  usageRef?: string
}

const sideBtn =
  'inline-flex shrink-0 items-center gap-1.5 self-stretch rounded-lg border border-border-default px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary disabled:opacity-50'

export default function ImageUrlInput({
  value,
  onChange,
  placeholder,
  className = '',
  endpoint,
  name,
  preview = true,
  ai,
  gallery,
}: {
  value: string
  onChange: (url: string) => void
  placeholder?: string
  className?: string
  endpoint?: string
  /** For uncontrolled server-action forms: also submit the value under this name. */
  name?: string
  preview?: boolean
  /** Adds an "AI image" button; hidden without the scope or the AI plan. */
  ai?: ImageUrlAi | false
  /** Adds a Gallery pick; on by default when `ai` is set. */
  gallery?: boolean
}) {
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  const showGallery = gallery ?? !!ai
  const extras = !!ai || showGallery
  async function pick(f: File | undefined) {
    if (!f) return
    setBusy(true)
    setErr(null)
    try {
      onChange(await uploadImage(f, endpoint))
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ''
    }
  }
  const sizes = ai
    ? (Array.isArray(ai.size) ? ai.size : [ai.size ?? 'square']).map(k => AI_SIZE_PRESETS[k]).filter(Boolean)
    : []
  return (
    <div>
      <div className={`flex items-center gap-2${extras ? ' flex-wrap' : ''}`}>
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder ?? 'https://… or upload'}
          className={`${className} flex-1 ${extras ? 'min-w-[10rem]' : 'min-w-0'}`}
        />
        {name && <input type="hidden" name={name} value={value} />}
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          hidden
          onChange={e => pick(e.target.files?.[0])}
        />
        <button type="button" onClick={() => file.current?.click()} disabled={busy} className={sideBtn}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}{' '}
          {busy ? 'Uploading…' : 'Upload'}
        </button>
        {showGallery && (
          <button type="button" onClick={() => setPicker(true)} disabled={busy} className={sideBtn}>
            <Images className="w-3.5 h-3.5" /> Gallery
          </button>
        )}
        {ai && (
          <AiMediaButton
            feature={ai.feature}
            scope={ai.scope}
            sizes={sizes.length ? sizes : [AI_SIZE_PRESETS.square]}
            defaultPrompt={ai.defaultPrompt}
            referenceImageUrl={ai.referenceImageUrl}
            usageRef={ai.usageRef}
            triggerClassName={sideBtn}
            onPick={img => onChange(img.url)}
          />
        )}
        {preview && value && /^(https?:)?\/\/|^\//.test(value) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-9 w-9 shrink-0 rounded object-cover border border-border-default" />
        )}
      </div>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      {picker && (
        <GalleryPicker
          mode="single"
          onClose={() => setPicker(false)}
          onConfirm={imgs => {
            setPicker(false)
            if (imgs[0]) onChange(imgs[0].image_url)
          }}
        />
      )}
    </div>
  )
}
