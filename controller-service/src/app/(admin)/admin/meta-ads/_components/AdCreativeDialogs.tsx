'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import Select from '@/components/ui/Select'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import AiMediaButton from '@/components/admin/ai/AiMediaButton'
import PreviewApply from '@/components/admin/channels/PreviewApply'
import { uploadImage } from '@/components/admin/ImageUrlInput'
import { api, btnGhost, btnPrimary, inputCls } from '@/components/admin/channels/ui'
import { Dialog } from '@/components/admin/kit/dialog'
import { useActionToast } from '@/components/admin/kit/toast'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { AI_SIZE_PRESETS } from '@/lib/ai/media-features'
import { productUrl } from '@/lib/social/product-url'
import { CTA_LABELS, CTA_TYPES, TEXT_LIMITS, type CtaType } from '@/lib/meta-ads/creative-spec'

export const ADS_ENDPOINT = '/api/admin/meta-ads/console/ads'
const WRITE = 'meta_ads_campaigns'
const AI_SIZES = [AI_SIZE_PRESETS.square, AI_SIZE_PRESETS.landscape]

interface Product {
  id: string
  name: string
  slug: string
  description: string | null
  images: string[]
}

/** Kit dialog kept open on backdrop click and Esc so a half-built ad is not lost; the X closes. */
function Shell({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <Dialog open onClose={onClose} title={title} size="lg" footer={footer} dismissible={false}>
      <div className="space-y-4">{children}</div>
    </Dialog>
  )
}

function Counter({ n, max, recommended }: { n: number; max: number; recommended?: number }) {
  const over = n > max
  const long = !over && recommended != null && n > recommended
  return (
    <span className={`text-[11px] ${over ? 'text-red-600' : long ? 'text-amber-600' : 'text-foreground-muted'}`}>
      {n}/{recommended ?? max}
      {long ? ` (max ${max}; may be cut off)` : ''}
    </span>
  )
}

function Field({ label, counter, children, group }: { label: string; counter?: React.ReactNode; children: React.ReactNode; group?: boolean }) {
  const Tag = group ? 'div' : 'label'
  return (
    <Tag className="block text-xs text-foreground-muted space-y-1">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        {counter}
      </span>
      {children}
    </Tag>
  )
}

function ProductSearch({ onPick }: { onPick: (p: Product) => void }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Product[]>([])
  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) {
      setRows([])
      return
    }
    let live = true
    const timer = setTimeout(() => {
      api<{ products: Product[] }>(`/api/admin/meta-ads/console/products?q=${encodeURIComponent(t)}`).then(r => {
        if (live && r.ok) setRows(r.data.products ?? [])
      })
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q])
  return (
    <div className="relative">
      <input className={inputCls} placeholder="Search the catalogue by name or SKU" aria-label="Product" value={q} onChange={e => setQ(e.target.value)} />
      {rows.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-lg border border-border-default bg-surface-elevated shadow-lg max-h-60 overflow-auto">
          {rows.map(p => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-secondary"
                onClick={() => {
                  onPick(p)
                  setQ('')
                  setRows([])
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.images[0] && <img src={p.images[0]} alt="" className="w-8 h-8 rounded object-cover" />}
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Product photos, an upload or an AI image (the chosen product photo is the AI reference). */
function ImageChoice({ photos, value, onChange, prompt }: { photos: string[]; value: string; onChange: (url: string) => void; prompt: string }) {
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const toast = useActionToast()
  const reference = photos.includes(value) ? value : photos[0]
  async function upload(f: File | undefined) {
    if (!f) return
    setBusy(true)
    try {
      onChange(await uploadImage(f))
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ''
    }
  }
  return (
    <div className="space-y-2">
      {photos.length > 0 && (
        <div className="flex gap-2 flex-wrap" role="group" aria-label="Product photos">
          {photos.map(u => (
            <button
              key={u}
              type="button"
              aria-pressed={value === u}
              onClick={() => onChange(u)}
              className={`w-16 h-16 rounded border-2 overflow-hidden ${value === u ? 'border-accent-500' : 'border-border-default'}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => upload(e.target.files?.[0])} />
        <button type="button" className={btnGhost} disabled={busy} onClick={() => file.current?.click()}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload
        </button>
        <AiMediaButton
          feature="meta_ads_image"
          sizes={AI_SIZES}
          defaultPrompt={prompt}
          referenceImageUrl={reference}
          saveToGallery
          onPick={img => onChange(img.url)}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {value && !photos.includes(value) && <img src={value} alt="Chosen image" className="w-16 h-16 rounded object-cover border border-border-default" />}
      </div>
    </div>
  )
}

export interface AdSet {
  id: string
  name: string
  status: string
  campaign: string | null
}

export function NewAdDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const canWrite = useCanWrite(WRITE)
  const [setup, setSetup] = useState<{ adsets: AdSet[]; page: { id: string; name: string | null; instagram: boolean } | null } | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [product, setProduct] = useState<Product | null>(null)
  const [f, setF] = useState({ adsetId: '', name: '', link: '', message: '', headline: '', description: '', cta: 'SHOP_NOW' as CtaType, imageUrl: '' })
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null)
  const set = (k: keyof typeof f, v: string) => setF(s => ({ ...s, [k]: v }))

  useEffect(() => {
    api(ADS_ENDPOINT).then(r => {
      if (!r.ok) return setLoadErr(r.data.error || 'Could not load ad sets')
      setSetup(r.data)
      if (r.data.adsets?.[0]) setF(s => ({ ...s, adsetId: s.adsetId || r.data.adsets[0].id }))
    })
  }, [])

  function pickProduct(p: Product) {
    setProduct(p)
    setF(s => ({
      ...s,
      name: s.name || p.name.slice(0, 200),
      link: productUrl(p.slug),
      headline: p.name.slice(0, TEXT_LIMITS.headline),
      message: s.message || (p.description ?? p.name).slice(0, TEXT_LIMITS.message.recommended),
      imageUrl: p.images[0] ?? s.imageUrl,
    }))
  }

  const adContext = product
    ? `Product: ${product.name}.${product.description ? ` ${product.description.replace(/<[^>]+>/g, ' ').slice(0, 400)}` : ''}`
    : 'An ad for the store.'
  const tooLong = f.headline.length > TEXT_LIMITS.headline || f.description.length > TEXT_LIMITS.description || f.message.length > TEXT_LIMITS.message.max
  const ready = canWrite && !!setup?.page && f.adsetId && f.name.trim() && f.link && f.message.trim() && f.headline.trim() && f.imageUrl && !tooLong

  if (payload)
    return (
      <PreviewApply
        writeScope="meta_ads_campaigns:write"
        endpoint={ADS_ENDPOINT}
        payload={payload}
        applyLabel="Create ad"
        onClose={() => setPayload(null)}
        onDone={() => {
          onDone()
          onClose()
        }}
      />
    )

  return (
    <Shell
      title="New ad"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!ready} onClick={() => setPayload({ action: 'create', ...f, status: 'PAUSED' })}>
            Preview
          </button>
        </>
      }
    >
      {loadErr && <p className="text-sm text-red-500">{loadErr}</p>}
      {setup && !setup.page && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
          Connect a Facebook Page under Social first; Meta ads run from a Page.
        </p>
      )}
      {setup?.page && (
        <p className="text-xs text-foreground-muted">
          Runs from the Page {setup.page.name ?? setup.page.id}
          {setup.page.instagram ? ' and its Instagram account' : ''}. The ad is created paused.
        </p>
      )}
      <Field group label="Ad set">
        <Select
          className="w-full"
          aria-label="Ad set"
          value={f.adsetId}
          onChange={v => set('adsetId', v)}
          placeholder={setup && !setup.adsets.length ? 'No ad sets synced yet' : 'Choose an ad set'}
          options={(setup?.adsets ?? []).map(s => ({ value: s.id, label: `${s.name}${s.campaign ? ` (${s.campaign})` : ''}`, hint: s.status }))}
        />
      </Field>
      <Field group label="Product (fills the link, headline and text)">
        <ProductSearch onPick={pickProduct} />
        {product && <span className="text-xs text-foreground">{product.name}</span>}
      </Field>
      <Field label="Ad name">
        <input className={inputCls} aria-label="Ad name" value={f.name} maxLength={200} onChange={e => set('name', e.target.value)} />
      </Field>
      <Field label="Link (UTM tags are added)">
        <input className={inputCls} aria-label="Link" value={f.link} onChange={e => set('link', e.target.value.trim())} placeholder="https://..." />
      </Field>
      <Field label="Primary text" counter={<Counter n={f.message.length} max={TEXT_LIMITS.message.max} recommended={TEXT_LIMITS.message.recommended} />}>
        <AIEnrichButton
          fieldLabel="Facebook ad primary text"
          value={f.message}
          onChange={v => set('message', v)}
          scope="meta_ads_campaigns:write"
          maxLength={TEXT_LIMITS.message.max}
          multiline
          write
          broadcast
          context={`${adContext} Primary text of a Facebook/Instagram ad; keep the hook within the first ${TEXT_LIMITS.message.recommended} characters.`}
        >
          <textarea className={`${inputCls} pr-8`} aria-label="Primary text" rows={3} maxLength={TEXT_LIMITS.message.max} value={f.message} onChange={e => set('message', e.target.value)} />
        </AIEnrichButton>
      </Field>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Headline" counter={<Counter n={f.headline.length} max={TEXT_LIMITS.headline} />}>
          <AIEnrichButton
            fieldLabel="Facebook ad headline"
            value={f.headline}
            onChange={v => set('headline', v)}
            scope="meta_ads_campaigns:write"
            maxLength={TEXT_LIMITS.headline}
            write
            broadcast
            context={`${adContext} Headline under the ad image.`}
          >
            <input className={`${inputCls} pr-8`} aria-label="Headline" maxLength={TEXT_LIMITS.headline} value={f.headline} onChange={e => set('headline', e.target.value)} />
          </AIEnrichButton>
        </Field>
        <Field label="Description (optional)" counter={<Counter n={f.description.length} max={TEXT_LIMITS.description} />}>
          <AIEnrichButton
            fieldLabel="Facebook ad link description"
            value={f.description}
            onChange={v => set('description', v)}
            scope="meta_ads_campaigns:write"
            maxLength={TEXT_LIMITS.description}
            write
            broadcast
            context={`${adContext} Short line under the headline.`}
          >
            <input className={`${inputCls} pr-8`} aria-label="Description" maxLength={TEXT_LIMITS.description} value={f.description} onChange={e => set('description', e.target.value)} />
          </AIEnrichButton>
        </Field>
      </div>
      <Field group label="Button">
        <Select<CtaType> className="w-full" aria-label="Button" value={f.cta} onChange={v => set('cta', v)} options={CTA_TYPES.map(c => ({ value: c, label: CTA_LABELS[c] }))} />
      </Field>
      <div className="space-y-1">
        <p className="text-xs text-foreground-muted">Image (square 1:1 or landscape 1.91:1)</p>
        <ImageChoice photos={product?.images ?? []} value={f.imageUrl} onChange={u => set('imageUrl', u)} prompt={product ? `${product.name}, lifestyle product photo for a Facebook ad` : ''} />
      </div>
    </Shell>
  )
}

export function ChangeImageDialog({ ad, onClose, onDone }: { ad: { id: string; name: string; thumbnail: string | null }; onClose: () => void; onDone: () => void }) {
  const canWrite = useCanWrite(WRITE)
  const [product, setProduct] = useState<Product | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null)
  if (payload)
    return (
      <PreviewApply
        writeScope="meta_ads_campaigns:write"
        endpoint={ADS_ENDPOINT}
        payload={payload}
        applyLabel="Change image"
        onClose={() => setPayload(null)}
        onDone={() => {
          onDone()
          onClose()
        }}
      />
    )
  return (
    <Shell
      title={`Change the image of "${ad.name}"`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!canWrite || !imageUrl} onClick={() => setPayload({ action: 'image', adId: ad.id, imageUrl })}>
            Preview
          </button>
        </>
      }
    >
      <p className="text-xs text-foreground-muted">The text, link and button stay as they are; Meta reviews the ad again.</p>
      <Field group label="Product photos (optional)">
        <ProductSearch onPick={setProduct} />
      </Field>
      <ImageChoice photos={product?.images ?? []} value={imageUrl} onChange={setImageUrl} prompt={product ? `${product.name}, lifestyle product photo for a Facebook ad` : ad.name} />
    </Shell>
  )
}
