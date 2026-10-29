'use client'

import { useState, useEffect, useRef } from 'react'
import { MessageCircle, ChevronDown, LayoutTemplate } from 'lucide-react'
import AdminSelect from '@/components/admin/AdminSelect'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import ChatShell from '@/components/chat/ChatShell'
import Composer from '@/components/chat/Composer'
import MessageList from '@/components/chat/MessageList'
import type { SupportMessage } from '@/lib/support/types'

const isMine = (m: SupportMessage) => m.sender === 'admin'
const labelFor = (m: SupportMessage) => (m.sender === 'admin' ? m.senderName : null)

interface ThreadMessage {
  id: string
  direction: 'outbound' | 'inbound' | string
  to_number: string | null
  from_number: string | null
  body: string | null
  kind: string | null
  status: string | null
  delivery_status: string | null
  error: string | null
  provider_sid: string | null
  sent_at: string | null
}

interface TemplateEntry {
  label: string
  category: 'marketing' | 'support'
  fields: string[]
}

interface Prefill {
  cartItemsSummary: string
  cartCount: number
  latestOrder: { order_number: string; total_amount: string | number; id: string } | null
  latestOrderProduct: string
  notifyProduct: string
  feedbackUrl: string
  cartUrl: string
  amountFormatted: string
}

type Availability = Record<string, boolean>

interface Props {
  customerId: string
  phone: string | null
  marketingOptOut?: boolean
  forceOpen?: boolean
}

export default function WhatsAppEngagement({ customerId, phone, marketingOptOut, forceOpen }: Props) {
  const [isOpen, setIsOpen] = useState(!!forceOpen)
  const [isLoading, setIsLoading] = useState(false)
  const [thread, setThread] = useState<ThreadMessage[]>([])
  const lastInbound = [...thread].reverse().find(m => m.direction === 'inbound')?.body ?? ''
  const [templates, setTemplates] = useState<Record<string, TemplateEntry>>({})
  const [prefill, setPrefill] = useState<Prefill | null>(null)
  const [availability, setAvailability] = useState<Availability>({})
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({})
  const [freeText, setFreeText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const tplBox = useRef<HTMLDivElement>(null)
  const canWrite = useCanWrite('customers')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (isOpen && phone) {
      loadThread(true)
      pollRef.current = setInterval(() => loadThread(false), 10000)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [isOpen, phone, customerId])

  useEffect(() => {
    if (!templatesOpen) return
    const off = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      // AdminSelect's list is portalled; clicks inside it are still "in" the panel.
      if (!tplBox.current?.contains(t) && !t.closest?.('[role=listbox]')) setTemplatesOpen(false)
    }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [templatesOpen])

  async function loadThread(showLoading: boolean) {
    if (showLoading) setIsLoading(true)
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/whatsapp`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setThread(Array.isArray(data.thread) ? data.thread : [])
        if (data.templates) setTemplates(data.templates)
        if (data.prefill) setPrefill(data.prefill)
        if (data.availability) setAvailability(data.availability)
      }
    } catch {}
    if (showLoading) setIsLoading(false)
  }

  async function send(payload: { templateKey?: string; variables?: Record<string, string>; text?: string }) {
    if (isSending) return
    setIsSending(true)
    setSendError('')
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setFreeText('')
        setSelectedTemplate('')
        setTemplateVars({})
        await loadThread(false)
      } else {
        setSendError(data.error || 'Send failed')
        if (payload.text) setFreeText(payload.text)
      }
    } catch {
      setSendError('Send failed')
      if (payload.text) setFreeText(payload.text)
    }
    setIsSending(false)
  }

  function defaultVarsFor(key: string): Record<string, string> {
    if (!prefill) return {}
    switch (key) {
      case 'abandoned_cart':
        return { items: prefill.cartItemsSummary }
      case 'reorder_reminder':
        return { product: prefill.latestOrderProduct }
      case 'back_in_stock':
        return { product: prefill.notifyProduct }
      case 'feedback_request':
        return { orderNumber: prefill.latestOrder?.order_number || '', url: prefill.feedbackUrl }
      case 'return_initiated':
        return { orderNumber: prefill.latestOrder?.order_number || '' }
      case 'refund_processed':
        return { amount: prefill.amountFormatted, orderNumber: prefill.latestOrder?.order_number || '' }
      default:
        return {}
    }
  }

  function unavailableNote(key: string): string {
    switch (key) {
      case 'abandoned_cart':
        return ' — no cart items'
      case 'back_in_stock':
        return ' — no back-in-stock request'
      case 'reorder_reminder':
      case 'return_initiated':
      case 'refund_processed':
      case 'feedback_request':
        return ' — no orders yet'
      default:
        return ' — unavailable'
    }
  }

  function handleTemplateSelect(v: string) {
    setSelectedTemplate(v)
    setTemplateVars(v ? defaultVarsFor(v) : {})
    setSendError('')
  }

  async function handleSendTemplate() {
    if (!selectedTemplate || availability[selectedTemplate] === false) return
    await send({ templateKey: selectedTemplate, variables: templateVars })
  }

  const groupedTemplates = Object.entries(templates).reduce<Record<string, [string, TemplateEntry][]>>((acc, entry) => {
    const cat = entry[1].category
    ;(acc[cat] = acc[cat] || []).push(entry)
    return acc
  }, {})

  const activeTemplate = selectedTemplate ? templates[selectedTemplate] : null
  const isSelectedUnavailable = !!selectedTemplate && availability[selectedTemplate] === false
  const showOptOutWarning = !!marketingOptOut && activeTemplate?.category === 'marketing'

  const messages: SupportMessage[] = thread.map(m => {
    const out = m.direction === 'outbound'
    const st = (m.delivery_status || m.status || '').toLowerCase()
    return {
      id: m.id,
      sessionId: '',
      sender: out ? 'admin' : 'customer',
      senderName: out ? (m.kind ? m.kind.replace(/_/g, ' ') : null) : null,
      text: m.body ?? '',
      original: null,
      lang: null,
      at: m.sent_at ?? new Date(0).toISOString(),
      status: st === 'read' ? 'read' : st === 'delivered' ? 'delivered' : st === 'failed' || st === 'undelivered' ? 'failed' : 'sent',
      channel: 'whatsapp',
      payloads: [],
      attachments: [],
      clientId: null,
      error: m.error,
    }
  })

  const templatePanel = (
    <div className="absolute bottom-12 left-0 z-20 w-[min(24rem,85vw)] rounded-xl border border-border-default bg-surface-elevated shadow-xl p-3 space-y-2">
      <AdminSelect
        value={selectedTemplate}
        onChange={handleTemplateSelect}
        placeholder="Select a template…"
        options={Object.entries(groupedTemplates).flatMap(([cat, entries]) =>
          entries.map(([key, tpl]) => ({
            value: key,
            label: availability[key] === false ? `${tpl.label}${unavailableNote(key)}` : tpl.label,
            group: cat === 'marketing' ? 'Marketing' : 'Support',
          }))
        )}
      />
      {activeTemplate &&
        activeTemplate.fields.map(field => (
          <input
            key={field}
            type="text"
            value={templateVars[field] || ''}
            onChange={e => setTemplateVars(v => ({ ...v, [field]: e.target.value }))}
            placeholder={field}
            className="w-full px-3 h-control rounded-xl border border-border-default bg-surface text-foreground placeholder:text-foreground-muted text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
          />
        ))}
      {showOptOutWarning && (
        <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-xl border border-amber-400/40 leading-snug">
          This customer opted out of marketing. Sending anyway will override their preference.
        </p>
      )}
      {activeTemplate && (
        <button
          type="button"
          onClick={async () => {
            await handleSendTemplate()
            setTemplatesOpen(false)
          }}
          disabled={isSending || isSelectedUnavailable}
          className="w-full px-4 h-control bg-accent-500 hover:bg-accent-600 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSending ? 'Sending…' : isSelectedUnavailable ? `Unavailable${unavailableNote(selectedTemplate)}` : 'Send template'}
        </button>
      )}
    </div>
  )

  const conversation = (
    <ChatShell
      banner={
        sendError ? <p className="px-4 py-1.5 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-900/40">{sendError}</p> : undefined
      }
      composer={
        canWrite ? (
          <Composer
            text={freeText}
            setText={setFreeText}
            onSend={t => send({ text: t })}
            disabled={isSending}
            placeholder="Message (delivers within 24h of their last message; use a template otherwise)"
            accessory={
              <div ref={tplBox} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setTemplatesOpen(v => !v)}
                  title="Send a template"
                  aria-label="Send a template"
                  className={`h-10 w-10 rounded-full flex items-center justify-center hover:bg-surface-secondary ${templatesOpen ? 'text-accent-600 bg-surface-secondary' : 'text-foreground-secondary'}`}
                >
                  <LayoutTemplate className="w-5 h-5" />
                </button>
                {templatesOpen && templatePanel}
              </div>
            }
            inField={
              <AIEnrichButton
                placement="in-field"
                anchorClassName="absolute right-2 bottom-1.5"
                fieldLabel="WhatsApp message"
                value={freeText}
                onChange={setFreeText}
                scope="customers:write"
                write={!!lastInbound}
                context={`A one-to-one WhatsApp reply from the store to a customer; short, friendly, plain text.${lastInbound ? ` The customer wrote: "${lastInbound.slice(0, 600)}"` : ''}`}
              />
            }
          />
        ) : undefined
      }
    >
      <MessageList
        messages={messages}
        isMine={isMine}
        labelFor={labelFor}
        showTicks={isMine}
        empty={<p className="text-center text-xs text-foreground-muted pt-8">{isLoading ? 'Loading conversation…' : 'No WhatsApp messages yet.'}</p>}
      />
    </ChatShell>
  )

  if (!phone) {
    return (
      <div className={forceOpen ? 'p-5' : 'bg-surface-elevated rounded-xl border border-border-default p-5'}>
        <div className="flex items-center gap-2 mb-2">
          <MessageCircle className="w-4 h-4 text-foreground-muted" />
          <h2 className="font-semibold text-foreground">WhatsApp Engagement</h2>
        </div>
        <p className="text-sm text-foreground-muted">No phone number on file for this customer.</p>
      </div>
    )
  }

  // Modal mode: no accordion, content fills the modal height
  if (forceOpen) return <div className="h-full">{conversation}</div>

  // Standalone accordion mode (original behaviour)
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
      <button
        onClick={() => setIsOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-5 py-4 hover:bg-surface-secondary transition-colors"
      >
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
          <MessageCircle className="w-4 h-4 text-foreground-secondary" />
          <span className="font-semibold text-foreground">WhatsApp Engagement</span>
          {marketingOptOut && (
            <span className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full border border-amber-400/40">
              Opted out
            </span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-foreground-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && <div className="h-[28rem] border-t border-border-default">{conversation}</div>}
    </div>
  )
}
