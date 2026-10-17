'use client'

import { useEffect, useMemo, useState } from 'react'
import { Hash, Plus } from 'lucide-react'
import ImageUrlInput from '@/components/admin/ImageUrlInput'
import AiMediaButton from '@/components/admin/ai/AiMediaButton'
import AiVideoButton from '@/components/admin/ai/AiVideoButton'
import { AI_SIZE_PRESETS } from '@/lib/ai/media-features'
import AdminSelect from '@/components/admin/AdminSelect'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import DateTimePicker from '@/components/ui/DateTimePicker'
import Toggle from '@/components/ui/Toggle'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { productUrl } from '@/lib/social/product-url'
import { useActionToast } from '@/components/admin/kit'
import { Banner, Section, api, btnGhost, btnPrimary, inputCls } from '@/components/admin/channels/ui'
import {
  PLATFORMS,
  PLATFORM_LABEL,
  PLATFORM_NETWORK,
  PLATFORM_REQUIRES,
  TITLE_PLATFORMS,
  fillTemplate,
  fromLocalInput,
  hashtagCount,
  type NetworkInfo,
  type Platform,
  type Template,
} from './shared'

interface Product {
  id: string
  name: string
  slug: string
  short_description: string | null
  base_price: number | null
  stock_status: string | null
  product_images?: { image_url: string; thumbnail_url?: string; is_primary?: boolean }[]
}

const lbl = 'block text-xs font-medium text-foreground-secondary mb-1'

export default function Composer({
  networks,
  canApprove,
  onCreated,
  goAccounts,
}: {
  networks: NetworkInfo[] | null
  canApprove: boolean
  onCreated: () => void
  goAccounts: () => void
}) {
  const canWrite = useCanWrite('social')
  const { showToast } = useToast()
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [caption, setCaption] = useState('')
  const [hashtags, setHashtags] = useState('')
  const [title, setTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [productId, setProductId] = useState('')
  const [productName, setProductName] = useState('')
  const [product, setProduct] = useState<Product | null>(null)
  const [productLoading, setProductLoading] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [rawImage, setRawImage] = useState('')
  const [useAllImages, setUseAllImages] = useState(false)
  const [useAdCard, setUseAdCard] = useState(true)
  const [adCardUrl, setAdCardUrl] = useState('')
  const [adCardLoading, setAdCardLoading] = useState(false)
  const [videoUrl, setVideoUrl] = useState('')
  const [when, setWhen] = useState<'asap' | 'at'>('asap')
  const [at, setAt] = useState('')
  const [requestApproval, setRequestApproval] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [suggested, setSuggested] = useState<string[]>([])
  const [suggesting, setSuggesting] = useState(false)
  const [submitting, setSubmitting] = useState<'post' | 'draft' | null>(null)
  const toast = useActionToast()
  const setResult = (b: { ok: boolean; text: string } | null) => void (b && toast.result(b))

  const netOf = (p: Platform) => networks?.find(n => n.network === PLATFORM_NETWORK[p])
  const connected = (p: Platform) => netOf(p)?.status === 'connected'

  useEffect(() => {
    api<{ templates: Template[] }>('/api/admin/social/templates').then(r => r.ok && setTemplates(r.data.templates ?? []))
  }, [])

  useEffect(() => {
    if (!productId) {
      setProduct(null)
      return
    }
    let cancelled = false
    setProductLoading(true)
    fetch(`/api/admin/products/${productId}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(p => {
        if (cancelled || !p || p.error) return
        setProduct(p)
        const primary = (p.product_images || []).find((i: any) => i.is_primary) || (p.product_images || [])[0]
        setRawImage(primary?.image_url || '')
        if (primary?.image_url) setImageUrl(primary.image_url)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setProductLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [productId])

  // The ad card is rendered server-side per product so price and discount are current.
  useEffect(() => {
    if (!productId || !useAdCard) return
    let cancelled = false
    setAdCardLoading(true)
    fetch(`/api/admin/products/${productId}/ad-image`, { method: 'POST', credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d?.url) return
        setAdCardUrl(d.url)
        setImageUrl(d.url)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setAdCardLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [productId, useAdCard])

  function toggleAdCard(on: boolean) {
    setUseAdCard(on)
    if (!on) setImageUrl(rawImage)
    else if (adCardUrl) setImageUrl(adCardUrl)
  }

  function togglePlatform(p: Platform) {
    setPlatforms(ps => (ps.includes(p) ? ps.filter(x => x !== p) : [...ps, p]))
  }

  function applyTemplate(id: string) {
    const t = templates.find(x => x.id === id)
    if (!t) return
    const fill = product ? { name: product.name, price: product.base_price, url: productUrl(product.slug) } : null
    setCaption(fillTemplate(t.caption, fill))
    setHashtags(t.hashtags ?? '')
  }

  async function suggest() {
    const text = caption.trim() || (product ? `${product.name}. ${product.short_description ?? ''}` : '')
    setSuggesting(true)
    const r = await api<{ hashtags: string[] }>('/api/admin/social/hashtags', { method: 'POST', json: { text } })
    setSuggesting(false)
    if (!r.ok) return showToast(r.data.error || 'Suggestion failed', 'error')
    setSuggested(r.data.hashtags ?? [])
  }

  const tagList = hashtags.split(/\s+/).filter(Boolean)
  const addTag = (t: string) => {
    if (!tagList.includes(t)) setHashtags([...tagList, t].join(' '))
  }

  const fullText = caption.trim() + (hashtags.trim() ? `\n\n${hashtags.trim()}` : '')
  const allImages = (product?.product_images || []).map(i => i.image_url).filter(Boolean)
  const visualOnly = platforms.length > 0 && platforms.every(p => p === 'ig_reel' || p === 'youtube')
  const showTitle = platforms.some(p => TITLE_PLATFORMS.includes(p))

  const problems = useMemo(() => {
    const out: string[] = []
    if (!platforms.length) out.push('Choose at least one network')
    if (!caption.trim() && !productId) out.push('Write a caption or pick a product')
    for (const p of platforms) {
      const req = PLATFORM_REQUIRES[p]
      if (req?.image && !imageUrl.trim()) out.push(`${PLATFORM_LABEL[p]} needs an image`)
      if (req?.video && !videoUrl.trim()) out.push(`${PLATFORM_LABEL[p]} needs a video URL`)
    }
    if (when === 'at' && !at) out.push('Pick the date and time')
    return out
  }, [platforms, caption, productId, imageUrl, videoUrl, when, at])

  function reset() {
    setPlatforms([])
    setCaption('')
    setHashtags('')
    setTitle('')
    setLinkUrl('')
    setProductId('')
    setProductName('')
    setImageUrl('')
    setRawImage('')
    setUseAllImages(false)
    setUseAdCard(true)
    setAdCardUrl('')
    setVideoUrl('')
    setWhen('asap')
    setAt('')
    setSuggested([])
    setRequestApproval(false)
  }

  async function submit(draft: boolean) {
    setSubmitting(draft ? 'draft' : 'post')
    setResult(null)
    // Extra photos only go with raw images: behind the ad card they would bury it.
    const extra = !useAdCard && useAllImages && allImages.length >= 2 ? allImages.filter(u => u !== imageUrl.trim()) : null
    const r = await api<{ posts: { approval_status: string }[] }>('/api/admin/social-posts', {
      method: 'POST',
      json: {
        platforms,
        productId: productId || null,
        caption: caption.trim() || null,
        hashtags: hashtags.trim() || null,
        title: showTitle ? title.trim() || null : null,
        linkUrl: linkUrl.trim() || null,
        imageUrl: imageUrl.trim() || null,
        imageUrls: extra,
        videoUrl: videoUrl.trim() || null,
        scheduledAt: when === 'at' ? fromLocalInput(at) : null,
        draft,
        requestApproval: canApprove ? requestApproval : undefined,
      },
    })
    setSubmitting(null)
    if (!r.ok) {
      setResult({ ok: false, text: r.data.error || 'Could not create the post' })
      return
    }
    const n = r.data.posts?.length ?? 0
    const waiting = r.data.posts?.some(p => p.approval_status === 'pending')
    setResult({
      ok: true,
      text: `${draft ? 'Saved' : 'Queued'} ${n} post${n === 1 ? '' : 's'}${waiting ? '; they wait for approval before they publish' : ''}.`,
    })
    reset()
    onCreated()
  }

  if (!canWrite) return <Banner ok={false}>You can view posts but not create them.</Banner>

  return (
    <div className="space-y-4">
      {!canApprove && <Banner ok>Posts you create wait for someone with approval rights before they publish.</Banner>}

      <Section title="Networks">
        {!networks ? (
          <p className="text-sm text-foreground-muted">Loading...</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {PLATFORMS.map(p => {
              const on = connected(p)
              const checked = platforms.includes(p)
              return (
                <label
                  key={p}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${checked ? 'border-accent-500 bg-accent-500/5' : 'border-border-default'} ${on ? 'cursor-pointer' : 'opacity-50'}`}
                >
                  <input type="checkbox" disabled={!on} checked={checked} onChange={() => togglePlatform(p)} />
                  <span className="flex-1">{PLATFORM_LABEL[p]}</span>
                  {!on && (
                    <button type="button" onClick={goAccounts} className="text-xs text-accent-500 hover:underline">
                      Connect
                    </button>
                  )}
                </label>
              )
            })}
          </div>
        )}
      </Section>

      <Section title="Content">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={lbl}>Product (optional)</label>
              <AdminTypeahead
                type="products"
                value={productName}
                onChange={v => {
                  setProductName(v)
                  if (!v) setProductId('')
                }}
                onSelect={item => {
                  setProductId(item.id)
                  setProductName(item.label)
                }}
                placeholder="Search by name or SKU..."
                inputClassName={inputCls + ' pr-9'}
              />
            </div>
            <div>
              <label className={lbl}>Template</label>
              <AdminSelect
                sm
                value=""
                placeholder={templates.length ? 'Fill caption from a template' : 'No templates yet (Library tab)'}
                disabled={!templates.length}
                options={templates.map(t => ({ value: t.id, label: t.name }))}
                onChange={applyTemplate}
              />
            </div>
          </div>

          {productId && (productLoading || product) && (
            <div className="flex items-center gap-3 p-2.5 rounded-lg border border-border-default bg-surface-secondary">
              {productLoading || !product ? (
                <p className="text-xs text-foreground-muted">Loading product...</p>
              ) : (
                <>
                  {(() => {
                    const img = (product.product_images || []).find(i => i.is_primary) || product.product_images?.[0]
                    return img?.thumbnail_url || img?.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img.thumbnail_url || img.image_url} alt="" className="w-10 h-10 rounded-md object-cover border border-border-default shrink-0" />
                    ) : null
                  })()}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{product.name}</p>
                    <p className="text-xs text-foreground-muted truncate">
                      {product.base_price != null ? `Rs ${product.base_price}` : ''}
                      {product.stock_status ? ` - ${product.stock_status}` : ''}
                    </p>
                  </div>
                  {!visualOnly && !useAdCard && allImages.length >= 2 && (
                    <Toggle size="sm" checked={useAllImages} onChange={setUseAllImages} label={`Use all ${allImages.length} images (carousel)`} />
                  )}
                </>
              )}
            </div>
          )}

          {productId && !visualOnly && (
            <div className="flex items-start gap-3 p-2.5 rounded-lg border border-border-default bg-surface-secondary">
              {useAdCard && adCardUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={adCardUrl} alt="" className="w-10 h-[71px] rounded-md object-cover border border-border-default shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <Toggle checked={useAdCard} onChange={toggleAdCard} label="Post the ad card" />
                <p className="text-xs text-foreground-muted mt-0.5">
                  {adCardLoading
                    ? 'Generating ad card...'
                    : useAdCard
                      ? 'The 1080x1920 card the product list generates, with price, discount badge and product link burnt in.'
                      : 'Posting the raw product photos instead.'}
                </p>
              </div>
            </div>
          )}

          {showTitle && (
            <div>
              <label className={lbl}>Title (YouTube, Pinterest)</label>
              <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} />
            </div>
          )}

          <div>
            <label className={lbl}>Caption</label>
            <AIEnrichButton
              fieldLabel="Social media caption"
              value={caption}
              onChange={setCaption}
              scope="campaigns:write"
              context={`${product ? `Product: ${product.name}${product.short_description ? ' - ' + product.short_description : ''}. ` : ''}Networks: ${platforms.map(p => PLATFORM_LABEL[p]).join(', ') || 'social media'}.`}
              multiline
            >
              <textarea
                value={caption}
                onChange={e => setCaption(e.target.value)}
                rows={4}
                className={inputCls + ' resize-y pr-8'}
                placeholder={productId ? 'Leave blank to generate from the product' : 'Write the post'}
              />
            </AIEnrichButton>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={lbl + ' mb-0'}>Hashtags</label>
              <button type="button" className="text-xs text-accent-500 hover:underline inline-flex items-center gap-1 disabled:opacity-50" disabled={suggesting || (!caption.trim() && !product)} onClick={suggest}>
                <Hash className="w-3 h-3" /> {suggesting ? 'Suggesting...' : 'Suggest hashtags'}
              </button>
            </div>
            <input className={inputCls} value={hashtags} onChange={e => setHashtags(e.target.value)} placeholder="#tools #hardware" />
            {suggested.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {suggested.map(t => {
                  const added = tagList.includes(t)
                  return (
                    <button
                      key={t}
                      type="button"
                      disabled={added}
                      onClick={() => addTag(t)}
                      className="inline-flex items-center gap-1 rounded-full border border-border-default px-2 py-0.5 text-xs hover:bg-surface-secondary disabled:opacity-40"
                    >
                      {!added && <Plus className="w-3 h-3" />}
                      {t}
                    </button>
                  )
                })}
                <button type="button" className="text-xs text-accent-500 hover:underline" onClick={() => suggested.forEach(addTag)}>
                  Add all
                </button>
              </div>
            )}
          </div>

          {platforms.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {platforms.map(p => {
                const lim = netOf(p)?.limits
                if (!lim) return null
                const over = fullText.length > lim.caption
                const tags = hashtagCount(fullText)
                const tagsOver = lim.hashtags != null && tags > lim.hashtags
                const titleOver = lim.title != null && title.length > lim.title
                return (
                  <span key={p} className={`rounded-lg border px-2 py-1 text-xs tabular-nums ${over || tagsOver || titleOver ? 'border-red-500/50 text-red-500' : 'border-border-default text-foreground-muted'}`}>
                    {PLATFORM_LABEL[p]}: {fullText.length}/{lim.caption}
                    {lim.hashtags != null ? `, ${tags}/${lim.hashtags} hashtags` : ''}
                    {lim.title != null && showTitle ? `, title ${title.length}/${lim.title}` : ''}
                    {over || tagsOver || titleOver ? ' (will be shortened)' : ''}
                  </span>
                )
              })}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className={lbl}>Image URL</label>
                <AiMediaButton
                  feature="social_image"
                  compact
                  defaultPrompt={product?.name ? `${product.name}, product shot` : caption.slice(0, 160)}
                  sizes={
                    platforms.includes('ig_reel')
                      ? [AI_SIZE_PRESETS.story, AI_SIZE_PRESETS.portrait, AI_SIZE_PRESETS.square]
                      : [AI_SIZE_PRESETS.square, AI_SIZE_PRESETS.portrait, AI_SIZE_PRESETS.landscape, AI_SIZE_PRESETS.story]
                  }
                  referenceImageUrl={allImages[0]?.startsWith('http') ? allImages[0] : undefined}
                  saveToGallery
                  onPick={img => setImageUrl(img.url)}
                />
              </div>
              <ImageUrlInput value={imageUrl} onChange={setImageUrl} className={inputCls} placeholder="https://... or upload" />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className={lbl}>Video URL (Reels, YouTube)</label>
                {platforms.some(p => p === 'ig_reel' || p === 'youtube') && (
                  <AiVideoButton
                    feature="social_video"
                    compact
                    defaultPrompt={caption.slice(0, 160)}
                    defaultImageUrl={imageUrl || undefined}
                    defaultAspect="9:16"
                    onPick={url => setVideoUrl(url)}
                  />
                )}
              </div>
              <input className={inputCls} value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="https://..." />
            </div>
            <div className="sm:col-span-2">
              <label className={lbl}>Link</label>
              <input className={inputCls} value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder={productId ? 'The product page when blank' : 'https://...'} />
            </div>
          </div>
        </div>
      </Section>

      <Section title="When">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={when === 'asap'} onChange={() => setWhen('asap')} /> As soon as possible
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={when === 'at'} onChange={() => setWhen('at')} /> At a set time
            </label>
            {when === 'at' && <DateTimePicker value={at} onChange={setAt} className="w-64" placeholder="Select date and time" />}
          </div>
          {canApprove && <Toggle checked={requestApproval} onChange={setRequestApproval} label="Ask for approval before it publishes" />}
          {problems.length > 0 && <p className="text-xs text-foreground-muted">{problems.join('. ')}.</p>}
          <div className="flex gap-2">
            <button type="button" className={btnPrimary} disabled={!!submitting || problems.length > 0} onClick={() => submit(false)}>
              {submitting === 'post' ? 'Queuing...' : when === 'at' ? 'Schedule' : 'Post'}
            </button>
            <button type="button" className={btnGhost} disabled={!!submitting || !platforms.length} onClick={() => submit(true)}>
              {submitting === 'draft' ? 'Saving...' : 'Save as draft'}
            </button>
            <button type="button" className={btnGhost} onClick={reset}>
              Clear
            </button>
          </div>
        </div>
      </Section>
    </div>
  )
}
