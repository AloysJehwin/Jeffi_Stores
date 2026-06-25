'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Mail, Tag, Package, X, ChevronDown, Wand2 } from 'lucide-react'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import RichTextEditor from '@/components/admin/RichTextEditor'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'

interface Coupon {
  id: string
  code: string
  discount_type: 'percentage' | 'fixed'
  discount_value: number
  description: string | null
}

interface Product {
  id: string
  name: string
  base_price: number
  slug: string | null
}

type AttachMode = 'none' | 'coupon' | 'product'

interface Props {
  segmentKey: string
  segmentLabel: string
  recipientCount: number
  onClose: () => void
}

interface QuickTemplate {
  label: string
  subject: string
  headline: string
  body: string
}

const QUICK_TEMPLATES: Record<string, QuickTemplate[]> = {
  at_risk: [
    { label: 'Win Back', subject: 'We miss you — here\'s something special', headline: 'It\'s been a while!', body: 'We noticed you haven\'t shopped with us recently. We\'d love to have you back — here\'s an exclusive offer just for you.' },
    { label: 'Exclusive Deal', subject: 'An exclusive offer, just for you', headline: 'Your exclusive deal is waiting', body: 'As a valued customer, we\'ve put together a special offer we think you\'ll love.' },
  ],
  dormant: [
    { label: 'We Miss You', subject: 'We miss you — come back!', headline: 'It\'s been too long!', body: 'We haven\'t seen you in a while and we miss you. Here\'s a little something to welcome you back.' },
    { label: 'Come Back', subject: 'Your store is waiting for you', headline: 'Come back and see what\'s new', body: 'A lot has changed since your last visit. New arrivals, better prices, and an exclusive offer waiting just for you.' },
  ],
  vip: [
    { label: 'VIP Exclusive', subject: 'An exclusive VIP offer for you', headline: 'You\'re one of our best customers', body: 'We truly appreciate your loyalty. As a VIP customer, you get first access to our exclusive offers and new arrivals.' },
    { label: 'Thank You', subject: 'Thank you for being amazing', headline: 'A special thank you from us', body: 'Your continued support means everything to us. Here\'s a small token of our appreciation.' },
  ],
  loyal: [
    { label: 'Loyalty Reward', subject: 'Your loyalty reward is here', headline: 'Thanks for being a loyal customer!', body: 'Your consistent support means the world to us. We\'ve put together a special reward just for you.' },
    { label: 'New Arrivals', subject: 'New arrivals — first look for loyal customers', headline: 'You get first access!', body: 'As one of our most loyal customers, you get early access to our latest collection before anyone else.' },
  ],
  new: [
    { label: 'Welcome', subject: 'Welcome to Jeffi Store\'s!', headline: 'Welcome to the family!', body: 'We\'re thrilled to have you with us. Here\'s everything you need to know to get started, plus a special first-order offer.' },
    { label: 'First Order', subject: 'Your first order discount is waiting', headline: 'Special offer for new customers', body: 'As a new member of our community, we\'d like to offer you a special discount on your first purchase.' },
  ],
  lead: [
    { label: 'First Purchase', subject: 'Ready to make your first purchase?', headline: 'Your first order awaits', body: 'We noticed you haven\'t placed an order yet. Let us make it easy with a special welcome offer.' },
  ],
  b2b: [
    { label: 'B2B Offer', subject: 'Exclusive B2B pricing for your business', headline: 'Special business pricing inside', body: 'As a business customer, you have access to our exclusive B2B pricing and bulk order discounts.' },
  ],
  repeat: [
    { label: 'Thank You', subject: 'Thanks for coming back!', headline: 'We love having you back', body: 'Your repeat business means so much to us. Here\'s a little extra to say thank you.' },
  ],
  one_time: [
    { label: 'Come Back', subject: 'Your next purchase deserves a discount', headline: 'Ready for round two?', body: 'We loved having you shop with us. Here\'s an exclusive offer to bring you back for more.' },
  ],
}

const DEFAULT_TEMPLATES: QuickTemplate[] = [
  { label: 'Promotion', subject: 'A special offer just for you', headline: 'Don\'t miss this offer!', body: 'We have something special lined up just for you. Check it out before it\'s gone.' },
  { label: 'Announcement', subject: 'Important update from Jeffi Store\'s', headline: 'Exciting news!', body: 'We have some great news to share with you. Read on to find out more.' },
]

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistores.in'

const EMAIL_TEMPLATES = [
  { value: 'promotion', label: 'Promotion' },
  { value: 'announcement', label: 'Announcement' },
]

const inputCls = 'w-full px-3 py-1.5 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500'

export default function CrmMailerPanel({ segmentKey, segmentLabel, recipientCount, onClose }: Props) {
  const [templateKey, setTemplateKey] = useState<'promotion' | 'announcement'>('promotion')
  const [subject, setSubject] = useState('')
  const [headline, setHeadline] = useState('')
  const [body, setBody] = useState('')
  const [attachMode, setAttachMode] = useState<AttachMode>('none')

  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [couponsLoading, setCouponsLoading] = useState(false)
  const [selectedCoupon, setSelectedCoupon] = useState<Coupon | null>(null)
  const [couponOpen, setCouponOpen] = useState(false)

  const [productQuery, setProductQuery] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const productDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [tab, setTab] = useState<'compose' | 'preview'>('compose')
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number } | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  const { showToast } = useToast()
  const confirm = useConfirm()

  const quickTemplates = QUICK_TEMPLATES[segmentKey] || DEFAULT_TEMPLATES

  function applyQuickTemplate(tpl: QuickTemplate) {
    setSubject(tpl.subject)
    setHeadline(tpl.headline)
    setBody(tpl.body)
  }

  useEffect(() => {
    if (attachMode !== 'coupon') return
    setCouponsLoading(true)
    fetch('/api/admin/coupons?is_active=true&page=1', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setCoupons(d.coupons || []))
      .catch(() => {})
      .finally(() => setCouponsLoading(false))
  }, [attachMode])

  useEffect(() => {
    if (attachMode !== 'product') return
    if (productDebounce.current) clearTimeout(productDebounce.current)
    productDebounce.current = setTimeout(async () => {
      setProductsLoading(true)
      try {
        const qs = productQuery.trim() ? `?q=${encodeURIComponent(productQuery)}&limit=6` : `?featured=true&limit=6`
        const res = await fetch(`/api/admin/quotations/products${qs}`, { credentials: 'include' })
        const d = await res.json()
        const rows: Array<{ product_id: string; name: string; base_price: number; slug: string | null }> = Array.isArray(d.products) ? d.products : []
        const seen = new Set<string>()
        const deduped: Product[] = []
        for (const row of rows) {
          if (!seen.has(row.product_id)) {
            seen.add(row.product_id)
            deduped.push({ id: row.product_id, name: row.name, base_price: row.base_price || 0, slug: row.slug || null })
          }
        }
        setProducts(deduped.slice(0, 6))
      } catch {
        setProducts([])
      } finally {
        setProductsLoading(false)
      }
    }, productQuery.trim() ? 300 : 0)
  }, [productQuery, attachMode])

  const buildTemplateData = useCallback((): Record<string, string> => {
    const data: Record<string, string> = { headline, body }
    if (attachMode === 'product' && selectedProduct) {
      const productUrl = selectedProduct.slug ? `${BASE_URL}/products/${selectedProduct.slug}` : null
      data.body = [body, `\nCheck out: <strong>${selectedProduct.name}</strong> — starting at ₹${Math.round(selectedProduct.base_price).toLocaleString('en-IN')}${productUrl ? `\n<a href="${productUrl}" style="color:#e07b3f;">View Product →</a>` : ''}`].filter(Boolean).join('\n')
    }
    return data
  }, [headline, body, attachMode, selectedProduct])

  async function loadPreview() {
    setPreviewLoading(true)
    try {
      const res = await fetch('/api/admin/mailer/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_key: templateKey, template_data: buildTemplateData(), subject }),
      })
      const d = await res.json()
      setPreviewHtml(d.html || '')
    } finally {
      setPreviewLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'preview') loadPreview()
  }, [tab])

  async function handleSend() {
    if (!subject.trim() || !headline.trim()) {
      setSendError('Subject and headline are required.')
      return
    }
    setSendError(null)
    const ok = await confirm({
      title: 'Send Mailer',
      message: `Send mailer to ${recipientCount} ${segmentLabel} customers?`,
      confirmLabel: 'Send',
    })
    if (!ok) return
    setSending(true)
    try {
      const createRes = await fetch('/api/admin/mailer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: `${segmentLabel} — ${subject}`,
          template_key: templateKey,
          subject,
          template_data: buildTemplateData(),
          audience_type: 'segment',
          audience_filter: {
            segment: segmentKey,
            ...(attachMode === 'coupon' && selectedCoupon ? { couponId: selectedCoupon.id } : {}),
          },
        }),
      })
      if (!createRes.ok) { showToast('Failed to create mailer.', 'error'); return }
      const { id } = await createRes.json()
      const sendRes = await fetch(`/api/admin/mailer/${id}/send`, {
        method: 'POST',
        credentials: 'include',
      })
      if (sendRes.ok) {
        const result = await sendRes.json()
        setSendResult(result)
      } else {
        showToast('Failed to send. Check Mailer page.', 'error')
      }
    } finally {
      setSending(false)
    }
  }

  const aiContext = `Segment: ${segmentLabel}. Email template type: ${templateKey}. Store: Jeffi Store's (hardware/tools).`

  if (sendResult) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
        <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <Mail className="w-6 h-6 text-green-600 dark:text-green-400" />
        </div>
        <p className="text-sm font-semibold text-foreground">Mailer sent!</p>
        <p className="text-xs text-foreground-muted">{sendResult.sent} sent · {sendResult.failed} failed</p>
        <button type="button" onClick={onClose} className="mt-2 px-4 py-2 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold transition-colors">
          Close
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Compose / Preview tabs */}
      <div className="flex items-center gap-1 bg-surface-secondary rounded-lg p-0.5 self-start">
        {(['compose', 'preview'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              tab === t ? 'bg-surface-elevated shadow text-foreground' : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {t === 'compose' ? 'Compose' : 'Preview'}
          </button>
        ))}
      </div>

      {tab === 'compose' && (
        <>
          {/* Quick templates */}
          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Wand2 className="w-3 h-3" /> Quick Templates
            </label>
            <div className="flex gap-2 flex-wrap">
              {quickTemplates.map(tpl => (
                <button
                  key={tpl.label}
                  type="button"
                  onClick={() => applyQuickTemplate(tpl)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border-secondary bg-surface text-foreground-muted hover:text-foreground hover:border-accent-500 hover:bg-accent-500/5 transition-colors"
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>

          {/* Email template type */}
          <div className="flex gap-2">
            {EMAIL_TEMPLATES.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTemplateKey(t.value as 'promotion' | 'announcement')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  templateKey === t.value
                    ? 'bg-accent-500 border-accent-500 text-white'
                    : 'bg-surface border-border-secondary text-foreground-muted hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Subject */}
          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Subject *</label>
            <AIEnrichButton
              fieldLabel="Email Subject"
              value={subject}
              onChange={setSubject}
              context={aiContext}
            >
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder={`e.g. ${segmentLabel} — exclusive offer inside`}
                className={`${inputCls} pr-16`}
              />
            </AIEnrichButton>
          </div>

          {/* Headline */}
          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Headline *</label>
            <AIEnrichButton
              fieldLabel="Email Headline"
              value={headline}
              onChange={setHeadline}
              context={aiContext}
            >
              <input
                type="text"
                value={headline}
                onChange={e => setHeadline(e.target.value)}
                placeholder="e.g. We miss you! Here's something special"
                className={`${inputCls} pr-16`}
              />
            </AIEnrichButton>
          </div>

          {/* Body */}
          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Message</label>
            <RichTextEditor value={body} onChange={setBody} placeholder="Optional message body…" minHeight={180} />
            <p className="text-[11px] text-foreground-muted mt-1.5">
              Tokens like <code className="font-mono bg-surface-secondary px-1 rounded">{'{customer_first_name}'}</code> are replaced per recipient at send time.
            </p>
          </div>

          {/* Attachment mode */}
          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-2">Attach (optional)</label>
            <div className="flex gap-2 flex-wrap">
              {([
                { mode: 'none' as AttachMode, icon: <X className="w-3.5 h-3.5" />, label: 'None' },
                { mode: 'coupon' as AttachMode, icon: <Tag className="w-3.5 h-3.5" />, label: 'Coupon' },
                { mode: 'product' as AttachMode, icon: <Package className="w-3.5 h-3.5" />, label: 'Product' },
              ]).map(({ mode, icon, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => { setAttachMode(mode); setSelectedCoupon(null); setSelectedProduct(null); setProductQuery('') }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    attachMode === mode
                      ? 'bg-accent-500 border-accent-500 text-white'
                      : 'bg-surface border-border-secondary text-foreground-muted hover:text-foreground'
                  }`}
                >
                  {icon}{label}
                </button>
              ))}
            </div>
          </div>

          {/* Coupon picker */}
          {attachMode === 'coupon' && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setCouponOpen(o => !o)}
                className={`${inputCls} flex items-center justify-between`}
              >
                <span className={selectedCoupon ? 'text-foreground' : 'text-foreground-muted'}>
                  {selectedCoupon
                    ? `${selectedCoupon.code} — ${selectedCoupon.discount_type === 'percentage' ? `${selectedCoupon.discount_value}%` : `₹${selectedCoupon.discount_value}`} off`
                    : 'Select a coupon…'}
                </span>
                <ChevronDown className="w-4 h-4 text-foreground-muted shrink-0" />
              </button>
              {couponOpen && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-surface-elevated border border-border-default rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {couponsLoading
                    ? <p className="text-xs text-foreground-muted px-3 py-2">Loading…</p>
                    : coupons.length === 0
                    ? <p className="text-xs text-foreground-muted px-3 py-2">No active coupons found.</p>
                    : coupons.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => { setSelectedCoupon(c); setCouponOpen(false) }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-surface-secondary transition-colors"
                        >
                          <span className="font-semibold text-foreground">{c.code}</span>
                          <span className="ml-2 text-foreground-muted">
                            {c.discount_type === 'percentage' ? `${c.discount_value}%` : `₹${c.discount_value}`} off
                            {c.description && ` · ${c.description}`}
                          </span>
                        </button>
                      ))
                  }
                </div>
              )}
            </div>
          )}

          {/* Product picker */}
          {attachMode === 'product' && (
            <div>
              <input
                type="text"
                value={productQuery}
                onChange={e => { setSelectedProduct(null); setProductQuery(e.target.value) }}
                placeholder="Search products…"
                className={inputCls}
              />
              {selectedProduct ? (
                <div className="mt-1.5 flex items-center justify-between px-3 py-2 bg-surface-secondary rounded-lg text-xs">
                  <span className="font-semibold text-foreground">{selectedProduct.name}</span>
                  <button
                    type="button"
                    onClick={() => { setSelectedProduct(null); setProductQuery('') }}
                    className="text-foreground-muted hover:text-foreground ml-2"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="mt-1 border border-border-default rounded-lg overflow-hidden bg-surface-elevated">
                  {productsLoading
                    ? <p className="text-xs text-foreground-muted px-3 py-2">Loading…</p>
                    : products.length === 0
                    ? <p className="text-xs text-foreground-muted px-3 py-2">No products found.</p>
                    : products.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setSelectedProduct(p)}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-surface-secondary transition-colors border-b border-border-default last:border-0"
                        >
                          <span className="font-semibold text-foreground">{p.name}</span>
                          <span className="ml-2 text-foreground-muted">₹{Math.round(p.base_price).toLocaleString('en-IN')}</span>
                        </button>
                      ))
                  }
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'preview' && (
        <div className="border border-border-default rounded-lg overflow-hidden">
          {previewLoading
            ? <div className="flex items-center justify-center py-8"><span className="w-5 h-5 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" /></div>
            : (
              <>
                <div className="px-4 py-2 bg-surface-secondary border-b border-border-default text-xs">
                  <span className="text-foreground-muted">Subject:</span>{' '}
                  <span className="font-semibold text-foreground">{subject || '(no subject)'}</span>
                </div>
                <div className="p-4 bg-white text-zinc-900 text-xs max-h-64 overflow-y-auto" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </>
            )
          }
        </div>
      )}

      {/* Send */}
      <div className="flex flex-col gap-1 pt-1 border-t border-border-default">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !subject.trim() || !headline.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-xs font-semibold transition-colors disabled:opacity-60"
          >
            {sending
              ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Mail className="w-3.5 h-3.5" />
            }
            {sending ? 'Sending…' : `Send to ${recipientCount} ${segmentLabel}`}
          </button>
          <p className="text-[10px] text-foreground-muted">Subject and headline required to send.</p>
        </div>
        {sendError && <p className="text-xs text-red-500">{sendError}</p>}
      </div>
    </div>
  )
}
