'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Sparkles, X } from 'lucide-react'
import { useCanUseAi, useCanWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import Select from '@/components/ui/Select'
import { ap } from '@/lib/shared/admin-path'
import {
  AI_QUALITIES,
  AI_SIZE_PRESETS,
  type AiQuality,
  type AiSizePreset,
} from '@/lib/ai/media-features'

interface Props {
  feature: 'social_image' | 'product_image' | 'ads_image' | 'email_hero' | 'hero_image' | 'offer_image' | 'meta_ads_image' | 'generate_image'
  /** Area whose :write scope gates the button; defaults from the feature. */
  scope?: string
  /** Initial prompt (prefilled from context: product name, campaign title). */
  defaultPrompt?: string
  /** Size presets to offer; the first is pre-selected. */
  sizes: AiSizePreset[]
  /** Enables image-to-image when set (product lifestyle, clean background). */
  referenceImageUrl?: string
  /** Caller gets each chosen image URL (one or several). */
  onPick: (image: { url: string; width: number; height: number; blurhash?: string | null; galleryId?: string; productImageId?: string }) => void
  /** Also add each image to this product's images. */
  attachToProductId?: string
  /** Pass to also insert a gallery_images row (so the gallery picker can see it later). */
  saveToGallery?: boolean
  /** Logged on the usage row (product id, post id, campaign id). */
  usageRef?: string
  /** Button label; defaults to "AI image". */
  label?: string
  /** When true the trigger is a small inline link rather than a filled button. */
  compact?: boolean
}

const SCOPE_BY_FEATURE: Record<Props['feature'], string> = {
  social_image: 'social',
  product_image: 'products',
  ads_image: 'google_ads_campaigns',
  email_hero: 'mailer',
  hero_image: 'settings',
  offer_image: 'coupons',
  meta_ads_image: 'meta_ads_campaigns',
  generate_image: 'settings',
}

export default function AiMediaButton(props: Props) {
  const scope = props.scope ?? SCOPE_BY_FEATURE[props.feature]
  const canWrite = useCanWrite(scope)
  const canUseAi = useCanUseAi(scope)
  const [open, setOpen] = useState(false)
  if (!canWrite || !canUseAi) return null
  const btnCls = props.compact
    ? 'inline-flex items-center gap-1 text-xs text-accent-600 hover:text-accent-700'
    : 'inline-flex h-control items-center gap-1.5 rounded-lg border border-border-default px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary'
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnCls}>
        <Sparkles className="w-3.5 h-3.5" />
        {props.label || 'AI image'}
      </button>
      {open && <AiMediaDialog {...props} onClose={() => setOpen(false)} />}
    </>
  )
}

function AiMediaDialog({
  feature,
  defaultPrompt = '',
  sizes,
  referenceImageUrl,
  onPick,
  attachToProductId,
  saveToGallery,
  usageRef,
  onClose,
}: Props & { onClose: () => void }) {
  const { showToast } = useToast()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const [prompt, setPrompt] = useState(defaultPrompt)
  const [sizeKey, setSizeKey] = useState(sizes[0]?.key ?? 'square')
  const [quality, setQuality] = useState<AiQuality>('standard')
  const [n, setN] = useState(1)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<{ url: string; width: number; height: number; blurhash?: string | null; galleryId?: string; productImageId?: string }[] | null>(null)
  const [pricePerUnit, setPricePerUnit] = useState<number | null>(null)
  const [charged, setCharged] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [walletNotice, setWalletNotice] = useState<{ balanceInr: number; neededInr: number } | null>(null)

  const size = sizes.find(s => s.key === sizeKey) ?? sizes[0]

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const url = `/api/admin/ai/price?feature=${feature}&quality=${quality}`
        const r = await fetch(url, { credentials: 'include' })
        const j = await r.json().catch(() => ({}))
        if (!cancelled) setPricePerUnit(typeof j.priceInr === 'number' ? j.priceInr : null)
      } catch {
        if (!cancelled) setPricePerUnit(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [feature, quality])

  const totalPrice = useMemo(() => (pricePerUnit == null ? null : pricePerUnit * n), [pricePerUnit, n])

  async function generate() {
    if (prompt.trim().length < 3) {
      setError('Describe what you want (a sentence works).')
      return
    }
    setBusy(true)
    setError(null)
    setWalletNotice(null)
    try {
      const res = await fetch('/api/admin/ai/image', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature,
          prompt: prompt.trim(),
          width: size?.width,
          height: size?.height,
          n,
          quality,
          referenceImageUrl,
          attachToProductId,
          saveToGallery,
          ref: usageRef,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.status === 402) {
        setWalletNotice({ balanceInr: j.balanceInr ?? 0, neededInr: j.neededInr ?? 0 })
        return
      }
      if (!res.ok) throw new Error(j.error || 'Image generation failed')
      setResults(j.images || [])
      setCharged(typeof j.priceInr === 'number' ? j.priceInr : null)
    } catch (e) {
      setError((e as Error).message || 'Image generation failed')
    } finally {
      setBusy(false)
    }
  }

  function pick(img: { url: string; width: number; height: number; blurhash?: string | null; galleryId?: string; productImageId?: string }) {
    onPick(img)
    showToast('Image added', 'success')
    onClose()
  }

  if (!mounted) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-label="AI image">
      <div className="w-full max-w-2xl rounded-xl bg-surface-primary border border-border-default shadow-xl">
        <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <Sparkles className="w-4 h-4 text-accent-500" /> Generate image
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-surface-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-secondary">What to draw</label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border-default bg-surface-primary px-3 py-2 text-sm"
              placeholder="A clean studio shot of ..."
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground-secondary">Size</label>
              <Select className="w-full" aria-label="Size" value={sizeKey} onChange={setSizeKey} options={sizes.map(s => ({ value: s.key, label: s.label }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground-secondary">Quality</label>
              <Select<AiQuality> className="w-full" aria-label="Quality" value={quality} onChange={setQuality} options={AI_QUALITIES.map(q => ({ value: q.value, label: q.label }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground-secondary">Variants</label>
              <Select className="w-full" aria-label="Variants" value={n} onChange={setN} options={[1, 2, 3, 4].map(v => ({ value: v, label: String(v) }))} />
            </div>
          </div>
          {totalPrice != null && !results && (
            <p className="text-xs text-foreground-muted" data-testid="ai-price">
              {totalPrice > 0 ? `About ₹${totalPrice.toFixed(2)} for ${n} image${n > 1 ? 's' : ''}, charged to your wallet.` : 'No charge.'}
            </p>
          )}
          {walletNotice && (
            <div className="rounded-lg border border-amber-500/50 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
              Wallet balance ₹{walletNotice.balanceInr.toFixed(2)} is below the ₹{walletNotice.neededInr.toFixed(2)} needed.{' '}
              <a href={ap('/admin/wallet')} className="underline">Top up</a>.
            </div>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
          {results && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {results.map((img, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pick(img)}
                    className="group relative overflow-hidden rounded-lg border border-border-default hover:border-accent-500"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="" className="aspect-square w-full object-contain bg-surface-secondary" />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm font-semibold text-white opacity-0 group-hover:opacity-100">
                      Use this
                    </span>
                  </button>
                ))}
              </div>
              {charged != null && (
                <p className="text-xs text-foreground-muted" data-testid="ai-charge">
                  {charged > 0 ? `Charged ₹${charged.toFixed(2)} to your wallet.` : 'No charge.'}
                </p>
              )}
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border-default px-4 py-3">
          <button type="button" onClick={onClose} className="h-control rounded-lg border border-border-default px-3 text-xs font-semibold hover:bg-surface-secondary">
            Close
          </button>
          <button
            type="button"
            onClick={generate}
            disabled={busy || prompt.trim().length < 3}
            className="inline-flex h-control items-center gap-1.5 rounded-lg bg-accent-500 px-3 text-xs font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {busy ? 'Generating…' : results ? 'Regenerate' : 'Generate'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
