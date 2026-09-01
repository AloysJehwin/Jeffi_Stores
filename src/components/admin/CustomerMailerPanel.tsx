'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Mail, Tag, Package, X, ChevronDown, Wand2 } from 'lucide-react'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import RichTextEditor from '@/components/admin/RichTextEditor'
import { useToast } from '@/contexts/ToastContext'
import { RequireWrite } from '@/contexts/AdminScopesContext'

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

interface RecentOrder {
  id: string
  order_number: string | null
  total_amount: number
  status: string
  payment_status: string
  created_at: string
}

type AttachMode = 'none' | 'coupon' | 'product'

interface CustomerContext {
  customerId: string
  customerName: string
  customerEmail: string
  segments: string[]
  healthScore: number | null
  totalOrders: number
  lifetimeValue: number
  daysSinceLastOrder: number | null
  lastOrderAt: string | null
  recentOrders: RecentOrder[]
}

interface QuickTemplate {
  label: string
  subject: string
  headline: string
  body: string
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function buildQuickTemplates(ctx: CustomerContext): QuickTemplate[] {
  const { segments, healthScore, daysSinceLastOrder, totalOrders, lifetimeValue, customerName, recentOrders } = ctx
  const first = customerName.split(' ')[0] || 'there'
  const templates: QuickTemplate[] = []

  // ── Order-status-aware templates ────────────────────────────────────────────

  const processingOrder = recentOrders.find(o =>
    ['confirmed', 'processing'].includes(o.status)
  )
  if (processingOrder) {
    const ref = processingOrder.order_number ? `#${processingOrder.order_number}` : `placed on ${fmtDate(processingOrder.created_at)}`
    templates.push({
      label: 'Order Processing',
      subject: `Your order ${ref} is being prepared`,
      headline: `We're working on your order!`,
      body: `Hi ${first}, your order ${ref} is currently being processed by our team. We're carefully preparing your items and will dispatch them as soon as possible. We'll send you a tracking update once your order is on its way. Thank you for your patience!`,
    })
  }

  const shippedOrder = recentOrders.find(o =>
    ['dispatched', 'shipped', 'out_for_delivery'].includes(o.status)
  )
  if (shippedOrder) {
    const ref = shippedOrder.order_number ? `#${shippedOrder.order_number}` : `placed on ${fmtDate(shippedOrder.created_at)}`
    const statusLabel = shippedOrder.status === 'out_for_delivery' ? 'out for delivery' : 'on its way'
    templates.push({
      label: 'Order Shipped',
      subject: `Great news — your order ${ref} is ${statusLabel}!`,
      headline: `Your order is heading your way`,
      body: `Hi ${first}, exciting news! Your order ${ref} is now ${statusLabel}. You should receive it soon. If you have any questions about your delivery, feel free to reply to this email and we'll help you out right away.`,
    })
  }

  const deliveredOrder = recentOrders.find(o => o.status === 'delivered')
  if (deliveredOrder) {
    const ref = deliveredOrder.order_number ? `#${deliveredOrder.order_number}` : `placed on ${fmtDate(deliveredOrder.created_at)}`
    templates.push({
      label: 'Post-Delivery',
      subject: `How's your order ${ref} going?`,
      headline: `How are you enjoying your purchase?`,
      body: `Hi ${first}, we hope your order ${ref} arrived in perfect condition! We'd love to hear how you're getting on with your purchase. If you need any help, have questions, or just want to share feedback — we're always here for you.`,
    })
    templates.push({
      label: 'Review Request',
      subject: `${first}, share your experience with us`,
      headline: `How did we do?`,
      body: `Hi ${first}, thank you for your recent order ${ref}! Your feedback helps us improve and helps other customers make better decisions. We'd love it if you could take a moment to share your experience. It means a lot to us!`,
    })
  }

  const pendingPaymentOrder = recentOrders.find(o =>
    o.payment_status === 'pending' && !['cancelled', 'refunded'].includes(o.status)
  )
  if (pendingPaymentOrder) {
    const ref = pendingPaymentOrder.order_number ? `#${pendingPaymentOrder.order_number}` : `placed on ${fmtDate(pendingPaymentOrder.created_at)}`
    templates.push({
      label: 'Payment Pending',
      subject: `Action needed — payment pending for order ${ref}`,
      headline: `Your payment is still pending`,
      body: `Hi ${first}, we noticed the payment for your order ${ref} (₹${Math.round(Number(pendingPaymentOrder.total_amount)).toLocaleString('en-IN')}) is still pending. Please complete your payment at your earliest convenience so we can process and dispatch your order without delay. Reply to this email if you need any help.`,
    })
  }

  const returnOrder = recentOrders.find(o =>
    ['return_requested', 'return_approved', 'return_picked_up'].includes(o.status)
  )
  if (returnOrder) {
    const ref = returnOrder.order_number ? `#${returnOrder.order_number}` : `placed on ${fmtDate(returnOrder.created_at)}`
    const statusMsg = returnOrder.status === 'return_requested'
      ? 'we have received your return request and are reviewing it'
      : returnOrder.status === 'return_approved'
      ? 'your return has been approved and we are arranging a pickup'
      : 'your return has been picked up and is on its way back to us'
    templates.push({
      label: 'Return Update',
      subject: `Update on your return for order ${ref}`,
      headline: `Your return is in progress`,
      body: `Hi ${first}, just a quick update — ${statusMsg} for order ${ref}. We're working hard to make this as smooth as possible for you. Your refund or replacement will be processed as soon as we complete our inspection. Thank you for your patience!`,
    })
  }

  const cancelledOrder = recentOrders.find(o => o.status === 'cancelled')
  if (cancelledOrder) {
    const ref = cancelledOrder.order_number ? `#${cancelledOrder.order_number}` : `placed on ${fmtDate(cancelledOrder.created_at)}`
    templates.push({
      label: 'Post-Cancellation',
      subject: `${first}, we're sorry about order ${ref}`,
      headline: `We're sorry your order was cancelled`,
      body: `Hi ${first}, we understand cancellations can be frustrating and we're sorry if this caused any inconvenience. Your order ${ref} has been cancelled. If there's anything we can do to make this right, or if you'd like to re-order, please don't hesitate to reach out — we're here to help.`,
    })
  }

  const codOrder = recentOrders.find(o => o.payment_status === 'cod')
  if (codOrder) {
    const ref = codOrder.order_number ? `#${codOrder.order_number}` : `placed on ${fmtDate(codOrder.created_at)}`
    templates.push({
      label: 'COD Reminder',
      subject: `Reminder — please keep ₹${Math.round(Number(codOrder.total_amount)).toLocaleString('en-IN')} ready for order ${ref}`,
      headline: `Your cash-on-delivery order is on its way`,
      body: `Hi ${first}, your order ${ref} is being dispatched with cash-on-delivery payment. Please keep ₹${Math.round(Number(codOrder.total_amount)).toLocaleString('en-IN')} ready at the time of delivery. If you have any questions before your delivery arrives, feel free to reply to this email!`,
    })
  }

  // ── Segment-based templates ──────────────────────────────────────────────────

  if (segments.includes('dormant')) {
    templates.push({
      label: 'Win Back',
      subject: `${first}, we miss you at Jeffi Store's`,
      headline: `It's been a while, ${first}!`,
      body: `We noticed you haven't shopped with us in a while and we genuinely miss having you around. We'd love to welcome you back — there's a lot that's new since your last visit!`,
    })
  }

  if (segments.includes('at_risk')) {
    templates.push({
      label: 'Re-engage',
      subject: `${first}, your exclusive offer is waiting`,
      headline: `Don't let this slip away, ${first}`,
      body: `It's been ${daysSinceLastOrder ?? 'a while'} days since your last order and we don't want to lose you. We've put together something exclusive just for you — check it out before it expires!`,
    })
  }

  if (segments.includes('vip') || segments.includes('loyal')) {
    templates.push({
      label: 'VIP Reward',
      subject: `A personal thank you, ${first}`,
      headline: `You're one of our most valued customers!`,
      body: `With ₹${Math.round(lifetimeValue).toLocaleString('en-IN')} in lifetime purchases, you truly are one of our most valued customers. Your trust means everything to us and we want to say thank you with something special.`,
    })
    templates.push({
      label: 'Early Access',
      subject: `${first}, you get early access to our new arrivals`,
      headline: `First look — just for you`,
      body: `As one of our best customers, you get exclusive early access to our latest products before they go live for everyone. We thought you'd appreciate the first pick!`,
    })
  }

  if (segments.includes('lead') || totalOrders === 0) {
    templates.push({
      label: 'First Order',
      subject: `${first}, ready to place your first order?`,
      headline: `Your first order offer is here`,
      body: `We're really glad you're with us, ${first}! To help you get started, we've put together a special welcome offer exclusively for new customers. Don't miss it — it won't last forever!`,
    })
    templates.push({
      label: 'Welcome',
      subject: `Welcome to Jeffi Store's, ${first}!`,
      headline: `Welcome to the family!`,
      body: `Hi ${first}, welcome to Jeffi Store's! We're your one-stop destination for quality hardware and tools. Whether you're a professional or a DIY enthusiast, we've got exactly what you need. We're excited to have you with us!`,
    })
  }

  if (segments.includes('b2b')) {
    templates.push({
      label: 'B2B Offer',
      subject: `Exclusive business pricing for ${first}`,
      headline: `Special B2B pricing inside`,
      body: `Hi ${first}, as a business customer you have access to our exclusive B2B pricing, bulk order discounts, and dedicated account support. Let us know what you need and we'll put together the best deal for your business.`,
    })
    templates.push({
      label: 'Bulk Quote',
      subject: `${first}, let us quote your next bulk order`,
      headline: `Need a bulk order? We've got you covered`,
      body: `Hi ${first}, if you have upcoming bulk requirements, we'd love to put together a custom quote for you. Our B2B team is ready to offer the best pricing and fastest turnaround. Just reply to this email with your requirements and we'll get back to you quickly!`,
    })
  }

  if (segments.includes('repeat')) {
    templates.push({
      label: 'Thank You',
      subject: `Thank you for coming back, ${first}!`,
      headline: `We love having you back`,
      body: `Hi ${first}, thank you for being a repeat customer — it really means a lot to us! We're always working to make your experience better. Here's a little something to say thank you for your continued trust in us.`,
    })
  }

  if (segments.includes('one_time')) {
    templates.push({
      label: 'Second Order',
      subject: `${first}, your second order deserves a reward`,
      headline: `Ready for round two?`,
      body: `Hi ${first}, we loved having you shop with us! We'd love to make your second order even more rewarding. Here's an exclusive offer just for returning customers — we hope to see you again soon!`,
    })
  }

  if (segments.includes('new')) {
    templates.push({
      label: 'New Customer',
      subject: `${first}, here's everything you need to get started`,
      headline: `Let's make your first experience great!`,
      body: `Hi ${first}, welcome aboard! As a new customer, we want to make sure your first experience with us is nothing short of excellent. Here's a quick guide on what we offer and a special new-customer discount just for you.`,
    })
  }

  // ── Health-score templates ───────────────────────────────────────────────────

  if (healthScore !== null && healthScore < 30) {
    templates.push({
      label: 'Critical Check-in',
      subject: `${first}, we really want to hear from you`,
      headline: `Is there anything we can do better?`,
      body: `Hi ${first}, we've noticed you haven't been engaging with us recently and we're concerned we may have let you down somewhere. Your satisfaction matters deeply to us. Please reply to this email and let us know if there's anything we can improve — we'd love the chance to make things right.`,
    })
  } else if (healthScore !== null && healthScore < 50) {
    templates.push({
      label: 'Check In',
      subject: `${first}, just checking in`,
      headline: `How's everything going?`,
      body: `Hi ${first}, we wanted to reach out personally and check in. We always want to make sure you're getting the best from us. If there's anything on your mind — questions, feedback, or anything else — we're all ears!`,
    })
  }

  // ── Always-available universal templates ────────────────────────────────────

  templates.push({
    label: 'Promotion',
    subject: `${first}, a special offer just for you`,
    headline: `Something special from Jeffi Store's`,
    body: `Hi ${first}, we've put together an exclusive offer that we think you'll love. Don't miss out — this is only available for a limited time!`,
  })

  templates.push({
    label: 'New Arrivals',
    subject: `${first}, check out our latest arrivals`,
    headline: `New products just landed!`,
    body: `Hi ${first}, we've just added exciting new products to our range! From tools to hardware essentials, there's something for everyone. Come take a first look — we think you'll love what we've got in store.`,
  })

  templates.push({
    label: 'Stock Alert',
    subject: `${first}, items are going fast!`,
    headline: `Don't miss out — limited stock`,
    body: `Hi ${first}, some of our most popular items are selling out quickly. If there's something you've had your eye on, now's the time to grab it before it's gone!`,
  })

  templates.push({
    label: 'Festival Offer',
    subject: `${first}, celebrate with exclusive festival deals`,
    headline: `Festival special — just for you!`,
    body: `Hi ${first}, it's the season to celebrate! We've put together some amazing festival deals on our best products. Whether it's for yourself or as a gift, we've got great options at unbeatable prices.`,
  })

  templates.push({
    label: 'Follow Up',
    subject: `${first}, is there anything we can help with?`,
    headline: `We're here to help`,
    body: `Hi ${first}, we just wanted to reach out and let you know we're always here if you need anything. Whether it's product advice, an order update, or anything else — don't hesitate to reply to this email. We're happy to help!`,
  })

  return templates
}

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistores.in'

const EMAIL_TEMPLATES = [
  { value: 'promotion', label: 'Promotion' },
  { value: 'announcement', label: 'Announcement' },
]

const inputCls = 'w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500'

export default function CustomerMailerPanel({
  customerId, customerName, customerEmail, segments, healthScore,
  totalOrders, lifetimeValue, daysSinceLastOrder, lastOrderAt, recentOrders,
}: CustomerContext) {
  const ctx: CustomerContext = { customerId, customerName, customerEmail, segments, healthScore, totalOrders, lifetimeValue, daysSinceLastOrder, lastOrderAt, recentOrders }
  const quickTemplates = buildQuickTemplates(ctx)

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

  const { showToast, showConfirm } = useToast()

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
    const ok = await showConfirm({
      title: 'Send Mailer',
      message: `Send mailer to ${customerName} (${customerEmail})?`,
      confirmText: 'Send',
      type: 'info',
    })
    if (!ok) return
    setSending(true)
    try {
      const createRes = await fetch('/api/admin/mailer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: `${customerName} — ${subject}`,
          template_key: templateKey,
          subject,
          template_data: buildTemplateData(),
          audience_type: 'specific_user',
          audience_filter: {
            userId: customerId,
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

  const segmentLabel = segments.length > 0
    ? segments.map(s => s.replace(/_/g, ' ')).join(', ')
    : 'customer'

  const aiContext = [
    `Customer: ${customerName}.`,
    `Segment: ${segmentLabel}.`,
    healthScore !== null ? `Health score: ${healthScore}/100.` : '',
    daysSinceLastOrder !== null ? `Days since last order: ${daysSinceLastOrder}.` : totalOrders === 0 ? 'No orders yet.' : '',
    `Total orders: ${totalOrders}. Lifetime value: ₹${Math.round(lifetimeValue).toLocaleString('en-IN')}.`,
    `Email template type: ${templateKey}. Store: Jeffi Store's (hardware/tools).`,
  ].filter(Boolean).join(' ')

  if (sendResult) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
        <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <Mail className="w-5 h-5 text-green-600 dark:text-green-400" />
        </div>
        <p className="text-sm font-semibold text-foreground">Mailer sent!</p>
        <p className="text-xs text-foreground-muted">{sendResult.sent} delivered · {sendResult.failed} failed</p>
        <button
          type="button"
          onClick={() => { setSendResult(null); setSubject(''); setHeadline(''); setBody(''); setAttachMode('none'); setSelectedCoupon(null); setSelectedProduct(null); setTab('compose') }}
          className="mt-1 px-3 py-1.5 rounded-lg border border-border-secondary text-xs font-semibold text-foreground-muted hover:text-foreground transition-colors"
        >
          Send another
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
            <label className="text-xs font-semibold text-foreground-muted uppercase tracking-wide flex items-center gap-1.5">
              <Wand2 className="w-3 h-3" /> Quick Templates
            </label>
            <div className="flex gap-2 flex-wrap mt-2">
              {quickTemplates.map(tpl => (
                <button
                  key={tpl.label}
                  type="button"
                  onClick={() => { setSubject(tpl.subject); setHeadline(tpl.headline); setBody(tpl.body) }}
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
            <AIEnrichButton fieldLabel="Email Subject" value={subject} onChange={setSubject} context={aiContext}>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="e.g. A special offer just for you"
                className={`${inputCls} pr-16`}
              />
            </AIEnrichButton>
          </div>

          {/* Headline */}
          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Headline *</label>
            <AIEnrichButton fieldLabel="Email Headline" value={headline} onChange={setHeadline} context={aiContext}>
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
              Tokens like <code className="font-mono bg-surface-secondary px-1 rounded">{'{customer_first_name}'}</code> are replaced with the actual customer details when the email is sent.
            </p>
          </div>

          {/* Attachment */}
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
                  <span className="text-foreground-muted">To:</span>{' '}
                  <span className="font-semibold text-foreground">{customerEmail}</span>
                </div>
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
          <RequireWrite scope="customers:write">
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
            {sending ? 'Sending…' : `Send to ${customerName}`}
          </button>
          </RequireWrite>
          <p className="text-[10px] text-foreground-muted">Subject and headline required.</p>
        </div>
        {sendError && <p className="text-xs text-red-500">{sendError}</p>}
      </div>
    </div>
  )
}
