'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Eye, EyeOff, Loader2, MessageSquareReply, Send, Sparkles, User, Users } from 'lucide-react'
import { useActionToast } from '@/components/admin/kit/toast'
import { fieldInputCls } from '@/components/admin/kit/form'
import { Sk } from '@/components/admin/kit/skeleton'
import AdminSelect from '@/components/admin/AdminSelect'
import EmailComposer from '@/components/admin/email-composer/EmailComposer'
import type { ComposerVariable } from '@/components/admin/email-composer/variables'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import { useCanUseAi, useCanWrite } from '@/contexts/AdminScopesContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import type { OrderMailTemplate } from '@/lib/orders/customer-mail'

/**
 * Who the email goes to: one order's customer (the order page), or the customer of every order a
 * list's filters match, one email per order (the Orders list). `query` is the list's own filter
 * query string, as its CSV export sends it.
 */
export type MailTarget =
  | { kind: 'order'; orderId: string; orderNumber: string; customerName: string; customerEmail: string }
  | { kind: 'list'; query: string }

type Loaded = {
  templates: OrderMailTemplate[]
  // One order
  order?: { status: string; paymentStatus: string | null; email: string }
  items?: { id: string; name: string; quantity: number }[]
  // A list of orders
  count?: number
  capped?: boolean
  cap?: number
  sample?: { orderNumber: string } | null
}

const CUSTOM = 'custom'

// The order's own details, offered in the composer's "Insert variable" menu ahead of the shared ones.
const orderVar = (key: string, label: string, description: string, sample: string): ComposerVariable => ({
  key,
  label,
  description,
  group: 'order',
  sample,
  builtIn: true,
  section: 'This order',
})
const ORDER_VARIABLES: ComposerVariable[] = [
  orderVar('order_date', 'Order date', 'The day the order was placed', '4 November 2026'),
  orderVar('total', 'Order total', 'The order total in rupees', '2,499.00'),
  orderVar('order_url', 'Order link', 'The customer’s page for this order', 'https://…/orders/…'),
  orderVar('expected_delivery', 'Expected delivery', 'The courier’s expected delivery date, once known', '12 November 2026'),
  orderVar('tracking_url', 'Tracking link', 'Where the customer follows the shipment, once shipped', 'https://…/track/…'),
  orderVar('courier', 'Courier', 'The courier carrying the order, once shipped', 'Delhivery'),
  orderVar('awb', 'Tracking number', 'The courier’s tracking number, once shipped', '1234567890'),
  orderVar('delivery_address', 'Delivery address', 'Where the order is going', '12 MG Road, Raipur, Chhattisgarh, 492001'),
  orderVar('refund_amount', 'Refund amount', 'The amount refunded (or the order total)', '2,499.00'),
  orderVar('payment_url', 'Payment link', 'A link to pay for the order; created when the email is sent', 'https://rzp.io/…'),
]
const ITEM_VARIABLE = orderVar('item_name', 'Item name', 'The item this email is about (picked below)', 'Cordless drill')

export default function OrderMailForm({
  target,
  active,
  onSent,
  onClose,
}: {
  target: MailTarget
  /** The form is on screen: templates load on first show, and the preview only refreshes while shown. */
  active: boolean
  onSent: () => void
  onClose: () => void
}) {
  const isList = target.kind === 'list'
  const qs = target.kind === 'list' && target.query ? `?${target.query}` : ''
  const templatesUrl = target.kind === 'list' ? `/api/admin/orders/bulk-mail${qs}` : `/api/admin/orders/${target.orderId}/mail-templates`
  const previewUrl = target.kind === 'list' ? `/api/admin/orders/bulk-mail/preview${qs}` : `/api/admin/orders/${target.orderId}/send-customer-mail/preview`
  const sendUrl = target.kind === 'list' ? `/api/admin/orders/bulk-mail${qs}` : `/api/admin/orders/${target.orderId}/send-customer-mail`

  const [data, setData] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [subject, setSubject] = useState('')
  const [preheader, setPreheader] = useState('')
  const [body, setBody] = useState('')
  const [itemId, setItemId] = useState('')
  const [storeLayout, setStoreLayout] = useState(true)
  const [sending, setSending] = useState(false)
  const [missing, setMissing] = useState<string[]>([])
  const [checking, setChecking] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [scenarioPrompt, setScenarioPrompt] = useState('')
  const [scenarioLoading, setScenarioLoading] = useState(false)
  const [scenarioError, setScenarioError] = useState<string | null>(null)
  const toast = useActionToast()
  const confirm = useConfirm()
  const canUseAi = useCanUseAi('mailer:write')
  const canWriteOrders = useCanWrite('orders')
  const canWriteMailer = useCanWrite('mailer')
  const canSend = canWriteOrders && canWriteMailer
  const checkSeq = useRef(0)
  const loadStarted = useRef(false)

  const template = data?.templates.find(t => t.slug === selected) ?? null
  const scenario = template?.scenario ?? null
  const isCustom = selected === CUSTOM
  // Off: the body goes out exactly as written, without the store's header and footer.
  const layout = !storeLayout ? 'raw' : isCustom ? 'message' : 'template'
  const fitting = data?.templates.filter(t => t.fits) ?? []
  const others = data?.templates.filter(t => !t.fits) ?? []
  const count = data?.count ?? 0
  const sampleNumber = data?.sample?.orderNumber ?? ''

  function choose(slug: string, list = data?.templates ?? []) {
    setSelected(slug)
    setItemId('')
    setScenarioError(null)
    if (slug === CUSTOM) {
      setSubject('Message from {{store_name}}')
      setPreheader('')
      setBody('')
      setStoreLayout(true)
      return
    }
    const t = list.find(x => x.slug === slug)
    if (!t) return
    setStoreLayout(t.layout !== 'none')
    setSubject(t.subject)
    setPreheader(t.preheader)
    setBody(t.body)
  }

  async function load() {
    setLoadError(false)
    try {
      const res = await fetch(templatesUrl)
      if (!res.ok) throw new Error()
      const d = (await res.json()) as Loaded
      setData(d)
      // A list has no one state to suit, so it starts on a blank message rather than the first template.
      choose(isList ? CUSTOM : d.templates.find(t => t.fits)?.slug ?? CUSTOM, d.templates)
    } catch {
      setLoadError(true)
      choose(CUSTOM, [])
    }
  }

  useEffect(() => {
    if (!active || loadStarted.current) return
    loadStarted.current = true
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, the first time the form is shown
  }, [active])

  // Fill the order details server-side: the preview and the list of tokens that would go out empty.
  useEffect(() => {
    if (!active || !selected || !body.trim() || (isList && !count)) {
      setMissing([])
      setPreviewHtml(null)
      return
    }
    const seq = ++checkSeq.current
    setChecking(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(previewUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject, body, preheader, scenario: scenario?.id, itemId: itemId || undefined, layout }),
        })
        const d = await res.json()
        if (seq !== checkSeq.current) return
        setMissing(res.ok ? d.missing ?? [] : [])
        setPreviewHtml(res.ok ? d.html ?? '' : '')
      } catch {
        if (seq === checkSeq.current) setPreviewHtml('')
      } finally {
        if (seq === checkSeq.current) setChecking(false)
      }
    }, 500)
    return () => clearTimeout(t)
  }, [active, selected, subject, body, preheader, itemId, previewUrl, scenario?.id, layout, isList, count])

  async function generateFromScenario() {
    if (scenarioPrompt.trim().length < 10 || scenarioLoading) return
    setScenarioLoading(true)
    setScenarioError(null)
    try {
      const res = await fetch('/api/admin/ai-generate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          target.kind === 'list'
            ? {
                scenario: `This email is sent once per order, to the customer of each of several orders. Do not write any one customer's name or order number: use the variables. ${scenarioPrompt}`,
                subject,
                variables: ORDER_VARIABLES.map(v => v.key),
              }
            : { scenario: `Order #${target.orderNumber} for ${target.customerName}. ${scenarioPrompt}`, subject }
        ),
      })
      const d = (await res.json()) as { html?: string; error?: string }
      if (!res.ok || !d.html) setScenarioError(d.error || 'Generation failed')
      else setBody(d.html)
    } catch {
      setScenarioError('Network error')
    } finally {
      setScenarioLoading(false)
    }
  }

  const needsItem = !isList && !!scenario?.pickItem && !itemId
  // The item's name comes from the picker, so ask for that rather than calling it missing.
  const gaps = needsItem ? missing.filter(k => k !== 'item_name') : missing
  // One order: a gap blocks the send. A list: an order with a gap is skipped, so the first order's gaps only warn.
  const blocked = isList
    ? sending || !subject.trim() || !body.trim() || !count || !!data?.capped
    : sending || checking || !subject.trim() || !body.trim() || missing.length > 0 || needsItem

  async function handleSend() {
    if (blocked) return
    if (isList) {
      const ok = await confirm({
        title: `Email ${count.toLocaleString('en-IN')} order${count === 1 ? '' : 's'}?`,
        message: 'One email goes to the customer of each order matching the current filters. Sent emails cannot be recalled.',
        confirmLabel: `Send ${count.toLocaleString('en-IN')} email${count === 1 ? '' : 's'}`,
      })
      if (!ok) return
    }
    setSending(true)
    try {
      const res = await fetch(sendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          body,
          preheader: preheader || undefined,
          isHtml: true,
          layout,
          scenario: scenario?.id,
          ...(isList ? { count } : { itemId: itemId || undefined }),
        }),
      })
      const d = await res.json()
      if (res.ok) {
        if (!isList) toast.success(scenario?.reply ? 'Email sent. Their reply will show on this order.' : 'Email sent.')
        else if (d.done) toast[d.sent ? 'success' : 'error'](d.summary || 'Done.')
        else toast.success(`Sending to ${Number(d.total).toLocaleString('en-IN')} orders. Each email shows in its order’s mail log, and the outcome in the audit log.`)
        setSelected(null)
        onSent()
      } else {
        if (d.missing) setMissing(d.missing)
        // The list changed under the administrator: show the new count before they send again.
        if (isList && typeof d.count === 'number') setData(prev => (prev ? { ...prev, count: d.count } : prev))
        toast.error(d.error || 'Failed to send email.')
      }
    } catch {
      toast.error('Network error. Please try again.')
    } finally {
      setSending(false)
    }
  }

  const chip = (slug: string, label: string) => (
    <button
      key={slug}
      type="button"
      onClick={() => choose(slug)}
      className={`px-3 h-control-sm rounded-lg border text-xs font-medium transition-colors ${
        selected === slug
          ? 'border-accent-500 bg-accent-500/10 text-accent-600 dark:text-accent-400'
          : 'border-border-default bg-surface text-foreground-secondary hover:bg-surface-secondary'
      }`}
    >
      {label}
    </button>
  )
  const label = (t: OrderMailTemplate) => t.scenario?.label ?? t.name
  const aiContext =
    target.kind === 'list'
      ? 'Email sent once per order to the customer of each of several orders. Keep the {{…}} tokens; do not write a specific name or order number.'
      : `Email to the customer about order #${target.orderNumber}.`

  return (
    <div className="space-y-4 min-w-0">
      {target.kind === 'order' ? (
        <div className="flex items-center gap-2 text-sm text-foreground-secondary">
          <User className="h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">
            To: <strong className="text-foreground">{target.customerName}</strong> &lt;{data?.order?.email || target.customerEmail}&gt;
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-2 text-sm text-foreground-secondary">
          <Users className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">
            {!data && !loadError ? (
              'Counting the orders…'
            ) : !count ? (
              'No orders match the current filters.'
            ) : (
              <>
                To: the customer of each of the{' '}
                <strong className="text-foreground">
                  {count.toLocaleString('en-IN')} order{count === 1 ? '' : 's'}
                </strong>{' '}
                matching the current filters, one email per order.
              </>
            )}
          </span>
        </div>
      )}
      {isList && data?.capped && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          More than {(data.cap ?? 0).toLocaleString('en-IN')} orders match. Narrow the filters and send in smaller batches.
        </p>
      )}

      {!data && !loadError ? (
        <div className="space-y-2">
          <Sk className="h-3 w-24" />
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3].map(i => (
              <Sk key={i} className="h-7 w-28 rounded-full" />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {fitting.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-foreground-muted">{isList ? 'Order templates' : 'For this order'}</p>
              <div className="flex flex-wrap gap-2">{fitting.map(t => chip(t.slug, label(t)))}</div>
            </div>
          )}
          {others.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-foreground-muted">Other order templates</p>
              <div className="flex flex-wrap gap-2">{others.map(t => chip(t.slug, label(t)))}</div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">{chip(CUSTOM, 'Custom message')}</div>
          {loadError && <p className="text-[11px] text-red-500">Could not load the templates. You can still write a custom message.</p>}
        </div>
      )}

      {template && !template.fits && scenario && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          This template is meant for orders in a different state ({data?.order?.status}).
        </p>
      )}
      {scenario?.reply && (
        <p className="flex items-start gap-1.5 text-[11px] text-foreground-muted">
          <MessageSquareReply className="mt-px h-3.5 w-3.5 shrink-0" />
          {isList
            ? 'Customers can reply to this email; each answer is recorded on their order.'
            : 'The customer can reply to this email; their answer is recorded on this order.'}
        </p>
      )}

      {!isList && scenario?.pickItem && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Which item?</label>
          <AdminSelect
            value={itemId}
            onChange={setItemId}
            options={[
              { value: '', label: 'Choose the item' },
              ...(data?.items ?? []).map(i => ({ value: i.id, label: i.quantity > 1 ? `${i.name} (x${i.quantity})` : i.name })),
            ]}
          />
        </div>
      )}

      {isCustom && canUseAi && (
        <div className="space-y-2 rounded-lg border border-accent-500/40 bg-accent-500/5 p-3">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-accent-600">
            <Sparkles className="h-3.5 w-3.5" />
            Generate with AI
          </label>
          <textarea
            value={scenarioPrompt}
            onChange={e => setScenarioPrompt(e.target.value)}
            rows={2}
            className={`${fieldInputCls} resize-none py-2`}
            placeholder="Describe the situation, e.g. 'Apologise for the shipping delay and offer 10% off the next order'"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={generateFromScenario}
              disabled={scenarioLoading || scenarioPrompt.trim().length < 10}
              className="control-sm bg-accent-500 font-medium text-white hover:bg-accent-600 disabled:opacity-50"
            >
              {scenarioLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {scenarioLoading ? 'Generating…' : body ? 'Regenerate' : 'Generate'}
            </button>
            {scenarioError && <span className="text-[11px] text-red-500">{scenarioError}</span>}
          </div>
        </div>
      )}

      {selected && (
        <>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Subject</label>
            <AIEnrichButton fieldLabel="Email subject" value={subject} onChange={setSubject} scope="mailer:write" format="subject" write context={aiContext}>
              <input type="text" value={subject} onChange={e => setSubject(e.target.value)} className={`${fieldInputCls} pr-8`} />
            </AIEnrichButton>
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs font-medium text-foreground-secondary">
              <input type="checkbox" checked={storeLayout} onChange={e => setStoreLayout(e.target.checked)} className="h-4 w-4 accent-accent-500" />
              Store header &amp; footer
            </label>
            <p className="mt-1 text-[11px] text-foreground-muted">
              {storeLayout
                ? "The message is framed by your store's email header and footer."
                : 'Sent exactly as written, for a template that carries its own design.'}
            </p>
          </div>

          {(!isCustom || !storeLayout) && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Preview text</label>
              <input
                type="text"
                value={preheader}
                maxLength={200}
                onChange={e => setPreheader(e.target.value)}
                className={fieldInputCls}
                placeholder="Shown next to the subject in the inbox"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Message</label>
            <div className="relative">
              <EmailComposer
                value={body}
                onChange={setBody}
                placeholder="Write your message…"
                minHeight={260}
                extraVariables={!isList && scenario?.pickItem ? [...ORDER_VARIABLES, ITEM_VARIABLE] : ORDER_VARIABLES}
              />
              <AIEnrichButton
                placement="in-field"
                anchorClassName="absolute right-3 bottom-3 z-10"
                fieldLabel="Email message (HTML)"
                value={body}
                onChange={setBody}
                scope="mailer:write"
                format="html"
                write
                context={`${aiContext} Subject: "${subject}".`}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-foreground-muted">
              Tokens like <code className="rounded bg-surface-secondary px-1 font-mono">{'{{order_number}}'}</code> are filled in from{' '}
              {isList ? 'each order when its email is sent. Use Insert variable to add them.' : 'this order when the email is sent.'}
            </p>
          </div>

          {needsItem && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              Choose the item this email is about.
            </p>
          )}
          {gaps.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                {isList ? (
                  <>
                    The first order{sampleNumber ? ` (#${sampleNumber})` : ''} has nothing for {gaps.map(k => `{{${k}}}`).join(', ')} yet. An order
                    with nothing for a token is skipped, not sent with a gap.
                  </>
                ) : (
                  <>
                    This order has nothing for {gaps.map(k => `{{${k}}}`).join(', ')} yet. Remove {gaps.length > 1 ? 'them' : 'it'} or fill in the
                    text before sending.
                  </>
                )}
              </span>
            </div>
          )}

          {body.trim() && (
            <div>
              <button
                type="button"
                onClick={() => setShowPreview(s => !s)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-500 hover:text-accent-600"
              >
                {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showPreview ? 'Hide preview' : 'Preview email'}
              </button>
              {showPreview && (
                <div className="mt-2 overflow-hidden rounded-lg border border-border-default">
                  <div className="border-b border-border-default bg-surface-secondary px-3 py-2 text-xs text-foreground-muted">
                    {isList ? `As the customer of the first order${sampleNumber ? ` (#${sampleNumber})` : ''} will see it` : 'As the customer will see it'}
                  </div>
                  {previewHtml === null || (checking && !previewHtml) ? (
                    <div className="flex items-center gap-2 p-4 text-xs text-foreground-muted">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading preview…
                    </div>
                  ) : previewHtml ? (
                    <iframe srcDoc={previewHtml} className="w-full border-0" style={{ height: 520 }} sandbox="allow-same-origin" title="Email preview" />
                  ) : (
                    <p className="p-4 text-xs text-foreground-muted">Preview unavailable.</p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {canSend && (
              <button
                type="button"
                onClick={handleSend}
                disabled={blocked}
                className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sending ? 'Sending…' : isList ? `Send to ${count.toLocaleString('en-IN')} order${count === 1 ? '' : 's'}` : 'Send email'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="control-md border border-border-default font-semibold text-foreground-secondary hover:bg-surface-secondary"
            >
              Close
            </button>
          </div>
        </>
      )}
    </div>
  )
}
