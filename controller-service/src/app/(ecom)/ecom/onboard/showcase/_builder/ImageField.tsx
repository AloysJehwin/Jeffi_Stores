'use client'

import { useState } from 'react'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { uploadShowcaseImage } from './useShowcaseDetails'

// One picture: a drop-in square that uploads on pick and shows what is there, with a way to take it off.

export default function ImageField({
  value,
  onChange,
  kind,
  label,
  className = 'h-24 w-24',
  fit = 'cover',
  siteId,
}: {
  value: string | null | undefined
  onChange: (url: string | null) => void
  kind: 'logo' | 'service' | 'work' | 'avatar'
  label: string
  className?: string
  fit?: 'cover' | 'contain'
  /** The site the picture is for; absent until a new site's draft is saved. */
  siteId?: string | null
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pick(file: File) {
    setBusy(true)
    setError(null)
    try {
      onChange(await uploadShowcaseImage(file, kind, siteId))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="shrink-0">
      <div className={`relative ${className}`}>
        <label className="ecom-focus flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-dashed border-border-default bg-surface text-center transition-colors hover:border-accent-500">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className={`h-full w-full ${fit === 'contain' ? 'object-contain p-2' : 'object-cover'}`} />
          ) : busy ? (
            <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
          ) : (
            <>
              <ImagePlus className="h-5 w-5 text-foreground-muted" />
              <span className="px-1 text-[11px] leading-tight text-foreground-muted">{label}</span>
            </>
          )}
          <input
            type="file"
            accept=".png,.jpg,.jpeg,.webp"
            className="sr-only"
            aria-label={value ? `Change: ${label}` : label}
            disabled={busy}
            onChange={e => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void pick(f)
            }}
          />
        </label>
        {value && !busy && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={`Remove: ${label}`}
            className="ecom-focus absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full border border-border-default bg-surface-elevated text-foreground-muted shadow-sm hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {value && busy && (
          <span className="absolute inset-0 grid place-items-center rounded-xl bg-white/70">
            <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
          </span>
        )}
      </div>
      {error && <p className="mt-1 max-w-[12rem] text-[11px] text-[#8a2e1f]">{error}</p>}
    </div>
  )
}
