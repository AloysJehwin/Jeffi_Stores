'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, ChevronDown, ImageIcon, Link2, Loader2, Search, Smartphone } from 'lucide-react'
import ImageUrlInput from '@/components/admin/ImageUrlInput'
import { VarInput } from '@/components/admin/campaigns/WaParamsForm'
import { renderConditionals, renderTemplate } from '@/lib/templates/variables-shared'
import { PUSH_BODY_MAX, PUSH_TITLE_MAX, validPushLink, type PushChannel } from '@/lib/push/copy'

// App push editing, shared by the Mailer composer and the scenario editor: title/body (with
// variables), optional image, a storefront link, and an Android notification preview.

const fill = (t: string, vars: Record<string, string | number>) => renderTemplate(renderConditionals(t || '', vars), vars).trim()

/** Android notification shade mock: the collapsed row and the expanded card with the big picture. */
export function PushPreview({
  title,
  body,
  image,
  vars = {},
  brand = 'Your store',
}: {
  title: string
  body: string
  image?: string | null
  vars?: Record<string, string | number>
  brand?: string
}) {
  const t = fill(title, vars) || 'Notification title'
  const b = fill(body, vars) || 'The message text shows here.'
  const img = image && /^https?:\/\//i.test(image) ? image : null
  const header = (open: boolean) => (
    <div className="flex items-center gap-1.5 text-[11px] text-[#5f5b66]">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#e07b3f] text-white">
        <Bell className="h-2.5 w-2.5" />
      </span>
      <span className="font-medium text-[#1c1b1f]">{brand}</span>
      <span>· now</span>
      <ChevronDown className={`ml-auto h-3.5 w-3.5 ${open ? 'rotate-180' : ''}`} />
    </div>
  )
  return (
    <div className="mx-auto w-full max-w-[360px] rounded-[28px] bg-[#1f1d24] p-3 shadow-inner">
      <p className="mb-2 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-white/60">
        <Smartphone className="h-3 w-3" /> Android · collapsed
      </p>
      <div className="rounded-2xl bg-[#f3eff6] px-3.5 py-3">
        {header(false)}
        <div className="mt-1.5 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-[#1c1b1f]">{t}</p>
            <p className="truncate text-[12.5px] text-[#49454f]">{b}</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {img && <img src={img} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />}
        </div>
      </div>
      <p className="mb-2 mt-3 px-1 text-[10px] font-semibold uppercase tracking-wide text-white/60">Expanded</p>
      <div className="rounded-2xl bg-[#f3eff6] px-3.5 py-3">
        {header(true)}
        <p className="mt-1.5 text-[13px] font-semibold text-[#1c1b1f]">{t}</p>
        <p className="mt-0.5 whitespace-pre-line text-[12.5px] leading-snug text-[#49454f] line-clamp-6">{b}</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {img && <img src={img} alt="" className="mt-2.5 aspect-[2/1] w-full rounded-xl object-cover" />}
      </div>
    </div>
  )
}

const QUICK: Array<{ label: string; path: string }> = [
  { label: 'Home', path: '/' },
  { label: 'All products', path: '/products' },
  { label: 'Offers', path: '/products?onSale=true' },
  { label: 'Cart', path: '/cart' },
  { label: 'Wishlist', path: '/wishlist' },
  { label: 'Rewards', path: '/account/rewards' },
]

interface LinkTarget {
  kind: string
  label: string
  path: string
  image_url: string | null
}

/** A storefront path: pick a product, category or offer, a common page, or type one. */
export function PushLinkField({
  value,
  onChange,
  inputClass,
  placeholder = '/products/…',
  allowEmpty,
}: {
  value: string
  onChange: (v: string) => void
  inputClass: string
  placeholder?: string
  /** Empty is allowed (the caller has a default, e.g. the scenario's product page). */
  allowEmpty?: string
}) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<LinkTarget[]>([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (q.trim().length < 2) {
      setItems([])
      return
    }
    const ctl = new AbortController()
    const t = setTimeout(() => {
      setBusy(true)
      fetch(`/api/admin/mailer/link-targets?q=${encodeURIComponent(q.trim())}`, { credentials: 'include', signal: ctl.signal })
        .then(r => (r.ok ? r.json() : { items: [] }))
        .then(d => {
          setItems(d.items || [])
          setOpen(true)
        })
        .catch(() => {})
        .finally(() => setBusy(false))
    }, 250)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [q])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const bad = !!value && !validPushLink(value)
  return (
    <div className="space-y-2">
      <input
        value={value}
        onChange={e => onChange(e.target.value.trim())}
        placeholder={allowEmpty ? `Default: ${allowEmpty}` : placeholder}
        className={`${inputClass} font-mono text-xs`}
      />
      {bad && <p className="text-xs text-red-600">Use a store path that starts with a single /, for example /products/drill.</p>}
      <div ref={box} className="relative">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onFocus={() => items.length && setOpen(true)}
            placeholder="Find a product, category or offer"
            className={`${inputClass} pl-8`}
          />
          {busy && <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-foreground-muted" />}
        </div>
        {open && items.length > 0 && (
          <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border-default bg-surface-elevated shadow-lg">
            {items.map(it => (
              <button
                key={`${it.kind}:${it.path}`}
                type="button"
                onClick={() => {
                  onChange(it.path)
                  setOpen(false)
                  setQ('')
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-secondary"
              >
                {it.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.image_url} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-surface-secondary">
                    <Link2 className="h-3.5 w-3.5 text-foreground-muted" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{it.label}</span>
                  <span className="block truncate font-mono text-[11px] text-foreground-muted">{it.path}</span>
                </span>
                <span className="text-[10px] uppercase tracking-wide text-foreground-muted">{it.kind}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {QUICK.map(p => (
          <button
            key={p.path}
            type="button"
            onClick={() => onChange(p.path)}
            className={`h-control-sm rounded-full border px-2.5 text-[11px] font-medium transition-colors ${value === p.path ? 'border-accent-500 bg-accent-500 text-white' : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'}`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const counter = (n: number, max: number) => (
  <span className={`text-[11px] tabular-nums ${n > max ? 'text-red-600' : 'text-foreground-muted'}`}>
    {n}/{max}
  </span>
)

/** Title, text, optional image and link of a push. */
export function PushFields({
  value,
  onChange,
  inputClass,
  labelClass,
  image = true,
  linkDefault,
  context,
}: {
  value: PushChannel
  onChange: (v: PushChannel) => void
  inputClass: string
  labelClass: string
  /** Offer the image field (the Mailer); scenarios use the product photo. */
  image?: boolean
  /** Shown when the link may stay empty. */
  linkDefault?: string
  /** What this push is about, for AI Enrich. */
  context?: string
}) {
  const set = (patch: Partial<PushChannel>) => onChange({ ...value, ...patch })
  return (
    <div className="space-y-4 rounded-lg border border-border-default p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground-secondary">
        <Bell className="h-3.5 w-3.5" /> App push
      </p>
      <div>
        <div className="flex items-center justify-between">
          <label className={labelClass}>Title</label>
          {counter(value.title.length, PUSH_TITLE_MAX)}
        </div>
        <VarInput
          value={value.title}
          onChange={v => set({ title: v })}
          placeholder="e.g. Diwali sale is live"
          className={inputClass}
          ai={{ label: 'Push title', context: `The title of an app push notification${context ? ` (${context})` : ''}. Short, no emoji spam.`, maxLength: PUSH_TITLE_MAX }}
        />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <label className={labelClass}>Text</label>
          {counter(value.body.length, PUSH_BODY_MAX)}
        </div>
        <VarInput
          value={value.body}
          onChange={v => set({ body: v })}
          rows={3}
          placeholder="One or two short lines. The first line shows when collapsed."
          className={inputClass}
          ai={{ label: 'Push text', context: `The text of an app push notification${context ? ` (${context})` : ''}. One or two short sentences.`, maxLength: PUSH_BODY_MAX }}
        />
      </div>
      {image && (
        <div>
          <label className={`${labelClass} flex items-center gap-1.5`}>
            <ImageIcon className="h-3.5 w-3.5" /> Image (optional)
          </label>
          <ImageUrlInput
            value={value.image_url ?? ''}
            onChange={v => set({ image_url: v.trim() || undefined })}
            placeholder="https://… or upload"
            className={inputClass}
            ai={{
              feature: 'campaign_image',
              size: ['landscape', 'wide', 'square'],
              defaultPrompt: context ? `Wide promo banner for: ${context}` : undefined,
            }}
          />
          {value.image_url && !/^https:\/\//i.test(value.image_url) && (
            <p className="mt-1 text-xs text-red-600">Android shows only https:// images.</p>
          )}
          <p className="mt-1 text-[11px] text-foreground-muted">Wide images (2:1) look best when the notification is expanded.</p>
        </div>
      )}
      <div>
        <label className={`${labelClass} flex items-center gap-1.5`}>
          <Link2 className="h-3.5 w-3.5" /> Opens
        </label>
        <PushLinkField value={value.link ?? ''} onChange={v => set({ link: v || undefined })} inputClass={inputClass} allowEmpty={linkDefault} />
      </div>
    </div>
  )
}
