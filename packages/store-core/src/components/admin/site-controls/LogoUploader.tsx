'use client'

import { useState, useRef } from 'react'
import { Images } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import GalleryPicker from '@/components/admin/GalleryPicker'
import AiMediaButton from '@/components/admin/ai/AiMediaButton'
import { AI_SIZE_PRESETS } from '@/lib/ai/media-features'

const sideBtn =
  'control-md inline-flex items-center gap-1.5 border border-border-default text-xs font-semibold text-foreground hover:bg-surface-secondary disabled:opacity-50'

export default function LogoUploader({ initialUrl, storeName }: { initialUrl: string; storeName?: string }) {
  const { showToast } = useToast()
  const [url, setUrl] = useState(initialUrl)
  const [busy, setBusy] = useState(false)
  const [picker, setPicker] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function save(init: RequestInit) {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/site-controls/logo', { method: 'POST', credentials: 'include', ...init })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.url) {
        setUrl(data.url)
        showToast('Logo updated', 'success')
      } else {
        showToast(data.error || 'Upload failed', 'error')
      }
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    await save({ body: form })
  }

  // Gallery and AI images are copied server-side from our own storage.
  const fromUrl = (imageUrl: string) =>
    save({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl }) })

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">Store Logo</label>
      <p className="text-xs text-foreground-muted mb-2">
        Shown in the site header, emails and PDFs. PNG with transparency recommended. Required — upload a replacement to
        change it.
      </p>
      <div className="flex items-center gap-4">
        <div className="h-16 w-40 rounded-lg border border-border-default bg-surface-secondary flex items-center justify-center overflow-hidden">
          {url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={url} alt="Store logo" className="max-h-14 max-w-[9rem] object-contain" />
          ) : (
            <span className="text-xs text-foreground-muted px-2 text-center">No logo</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={onFile}
            className="hidden"
          />
          <RequireWrite scope="settings:write">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="px-4 h-control text-sm font-medium bg-accent-500 hover:bg-accent-600 text-white rounded-lg transition-colors disabled:opacity-60"
            >
              {busy ? 'Uploading…' : url ? 'Replace logo' : 'Upload logo'}
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setPicker(true)} disabled={busy} className={sideBtn}>
                <Images className="h-3.5 w-3.5" /> Gallery
              </button>
              <AiMediaButton
                feature="logo_image"
                sizes={[AI_SIZE_PRESETS.landscape, AI_SIZE_PRESETS.square, AI_SIZE_PRESETS.wide]}
                defaultPrompt={
                  storeName
                    ? `Minimal wordmark logo for the store "${storeName}", bold modern lettering, plain white background, centred`
                    : undefined
                }
                onPick={img => void fromUrl(img.url)}
              />
            </div>
          </RequireWrite>
        </div>
      </div>
      {picker && (
        <GalleryPicker
          mode="single"
          onClose={() => setPicker(false)}
          onConfirm={imgs => {
            setPicker(false)
            if (imgs[0]) void fromUrl(imgs[0].image_url)
          }}
        />
      )}
    </div>
  )
}
