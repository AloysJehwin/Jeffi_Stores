'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, Eye, EyeOff, Loader2, Mail, MessageSquareReply, Send, Sparkles, User } from 'lucide-react'
import { useActionToast } from '@/components/admin/kit/toast'
import { fieldInputCls } from '@/components/admin/kit/form'
import AdminSelect from '@/components/admin/AdminSelect'
import EmailComposer from '@/components/admin/email-composer/EmailComposer'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import { useCanUseAi, useCanWrite } from '@/contexts/AdminScopesContext'
import type { OrderMailTemplate } from '@/lib/orders/customer-mail'

type Loaded = {
  order: { status: string; paymentStatus: string | null; email: string }
  items: { id: string; name: string; quantity: number }[]
  templates: OrderMailTemplate[]
}

const CUSTOM = 'custom'

interface Props {
  orderId: string
  orderNumber: string
  customerName: string
  customerEmail: string
}

export default function CustomerMailPanel({ orderId, orderNumber, customerName, customerEmail }: Props) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [subject, setSubject] = useState('')
  const [preheader, setPreheader] = useState('')
  const [body, setBody] = useState('')
  const [itemId, setItemId] = useState('')
  const [sending, setSending] = useState(false)
  const [missing, setMissing] = useState<string[]>([])
  const [checking, setChecking] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [scenarioPrompt, setScenarioPrompt] = useState('')
  const [scenarioLoading, setScenarioLoading] = useState(false)
  const [scenarioError, setScenarioError] = useState<string | null>(null)
  const toast = useActionToast()
  const canUseAi = useCanUseAi('mailer:write')
  const canWriteOrders = useCanWrite('orders')
  const canWriteMailer = useCanWrite('mailer')
  const canSend = canWriteOrders && canWriteMailer
  const checkSeq = useRef(0)

  const template = data?.templates.find(t => t.slug === selected) ?? null
  const scenario = template?.scenario ?? null
  const isCustom = selected === CUSTOM
  const fitting = data?.templates.filter(t => t.fits) ?? []
  const others = data?.templates.filter(t => !t.fits) ?? []

  function choose(slug: string, list = data?.templates ?? []) {
    setSelected(slug)
    setItemId('')
    setScenarioError(null)
    if (slug === CUSTOM) {
      setSubject('Message from {{store_name}}')
      setPreheader('')
      setBody('')
      return
    }
    const t = list.find(x => x.slug === slug)
    if (!t) return
    setSubject(t.subject)
    setPreheader(t.preheader)
    setBody(t.body)
  }

  async function load() {
    setLoadError(false)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/mail-templates`)
      if (!res.ok) throw new Error()
      const d = (await res.json()) as Loaded
      setData(d)
      choose(d.templates.find(t => t.fits)?.slug ?? CUSTOM, d.templates)
    } catch {
      setLoadError(true)
      choose(CUSTOM, [])
    }
  }

  // Fill the order details server-side: the preview and the list of tokens that would go out empty.
  useEffect(() => {
    if (!open || !selected || !body.trim()) {
      setMissing([])
      setPreviewHtml(null)
      return
    }
    const seq = ++checkSeq.current
    setChecking(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/orders/${orderId}/send-customer-mail/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject, body, preheader, scenario: scenario?.id, itemId: itemId || undefined, layout: isCustom ? 'message' : 'template' }),
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
  }, [open, selected, subject, body, preheader, itemId, orderId, scenario?.id, isCustom])

  async function generateFromScenario() {
    if (scenarioPrompt.trim().length < 10 || scenarioLoading) return
    setScenarioLoading(true)
    setScenarioError(null)
    try {
      const res = await fetch('/api/admin/ai-generate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: `Order #${orderNumber} for ${customerName}. ${scenarioPrompt}`, subject }),
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

  const needsItem = !!scenario?.pickItem && !itemId
  // The item's name comes from the picker, so ask for that rather than calling it missing.
  const gaps = needsItem ? missing.filter(k => k !== 'item_name') : missing
  const blocked = sending || checking || !subject.trim() || !body.trim() || missing.length > 0 || needsItem

  async function handleSend() {
    if (blocked) return
    setSending(true)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/send-customer-mail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          body,
          preheader: preheader || undefined,
          isHtml: true,
          layout: isCustom ? 'message' : 'template',
          scenario: scenario?.id,
          itemId: itemId || undefined,
        }),
      })
      const d = await res.json()
      if (res.ok) {
        toast.success(scenario?.reply ? 'Email sent. Their reply will show on this order.' : 'Email sent.')
        setOpen(false)
        setSelected(null)
      } else {
        if (d.missing) setMissing(d.missing)
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

  return (
    <section className="rounded-xl border border-border-default bg-surface-elevated">
      <button
        type="button"
        onClick={() => {
          if (!open && !data) void load()
          setOpen(o => !o)
        }}
        className="flex w-full items-center justify-between px-5 py-4 text-left">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 shrink-0 text-accent-500" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Customer Mail</h2>
        </div>
        <ChevronDown className={`h-4 w-4 text-foreground-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-border-default px-5 pb-5 pt-4">
          <div className="flex items-center gap-2 text-sm text-foreground-secondary">
            <User className="h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">
              To: <strong className="text-foreground">{customerName}</strong> &lt;{data?.order.email || customerEmail}&gt;
            </span>
          </div>

          {!data && !loadError ? (
            <div className="flex items-center gap-2 text-xs text-foreground-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading templates…
            </div>
          ) : (
            <div className="space-y-3">
              {fitting.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-foreground-muted">For this order</p>
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
              This template is meant for orders in a different state ({data?.order.status}).
            </p>
          )}
          {scenario?.reply && (
            <p className="flex items-start gap-1.5 text-[11px] text-foreground-muted">
              <MessageSquareReply className="mt-px h-3.5 w-3.5 shrink-0" />
              The customer can reply to this email; their answer is recorded on this order.
            </p>
          )}

          {scenario?.pickItem && (
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
                <AIEnrichButton
                  fieldLabel="Email subject"
                  value={subject}
                  onChange={setSubject}
                  scope="mailer:write"
                  format="subject"
                  write
                  context={`Email to the customer about order #${orderNumber}.`}
                >
                  <input type="text" value={subject} onChange={e => setSubject(e.target.value)} className={`${fieldInputCls} pr-8`} />
                </AIEnrichButton>
              </div>

              {!isCustom && (
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
                  <EmailComposer value={body} onChange={setBody} placeholder="Write your message…" minHeight={260} />
                  <AIEnrichButton
                    placement="in-field"
                    anchorClassName="absolute right-3 bottom-3 z-10"
                    fieldLabel="Email message (HTML)"
                    value={body}
                    onChange={setBody}
                    scope="mailer:write"
                    format="html"
                    write
                    context={`Email to the customer about order #${orderNumber}. Subject: "${subject}".`}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-foreground-muted">
                  Tokens like <code className="rounded bg-surface-secondary px-1 font-mono">{'{{order_number}}'}</code> are filled in
                  from this order when the email is sent.
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
                    This order has nothing for {gaps.map(k => `{{${k}}}`).join(', ')} yet. Remove {gaps.length > 1 ? 'them' : 'it'} or
                    fill in the text before sending.
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
                        As the customer will see it
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

              <div className="flex gap-3">
                {canSend && (
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={blocked}
                    className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {sending ? 'Sending…' : 'Send email'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="control-md border border-border-default font-semibold text-foreground-secondary hover:bg-surface-secondary"
                >
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
