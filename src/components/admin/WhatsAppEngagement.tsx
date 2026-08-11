'use client'

import { useState, useEffect, useRef } from 'react'
import { MessageCircle, Send, ChevronDown, Check, X } from 'lucide-react'
import AdminSelect from '@/components/admin/AdminSelect'

interface ThreadMessage {
  id: string
  direction: 'outbound' | 'inbound' | string
  to_number: string | null
  from_number: string | null
  body: string | null
  kind: string | null
  status: string | null
  error: string | null
  provider_sid: string | null
  sent_at: string | null
}

interface TemplateEntry {
  label: string
  category: 'marketing' | 'support'
  fields: string[]
}

interface Props {
  customerId: string
  phone: string | null
  marketingOptOut?: boolean
}

function formatTime(ts: string | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function WhatsAppEngagement({ customerId, phone, marketingOptOut }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [thread, setThread] = useState<ThreadMessage[]>([])
  const [templates, setTemplates] = useState<Record<string, TemplateEntry>>({})
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({})
  const [freeText, setFreeText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread])

  async function loadThread(showLoading: boolean) {
    if (showLoading) setIsLoading(true)
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/whatsapp`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setThread(Array.isArray(data.thread) ? data.thread : [])
        if (data.templates) setTemplates(data.templates)
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
      }
    } catch {
      setSendError('Send failed')
    }
    setIsSending(false)
  }

  function handleSendTemplate() {
    if (!selectedTemplate) return
    send({ templateKey: selectedTemplate, variables: templateVars })
  }

  function handleSendFreeText() {
    const text = freeText.trim()
    if (!text) return
    send({ text })
  }

  const groupedTemplates = Object.entries(templates).reduce<Record<string, [string, TemplateEntry][]>>((acc, entry) => {
    const cat = entry[1].category
    ;(acc[cat] = acc[cat] || []).push(entry)
    return acc
  }, {})

  const activeTemplate = selectedTemplate ? templates[selectedTemplate] : null

  if (!phone) {
    return (
      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <div className="flex items-center gap-2 mb-2">
          <MessageCircle className="w-4 h-4 text-foreground-muted" />
          <h2 className="font-semibold text-foreground">WhatsApp Engagement</h2>
        </div>
        <p className="text-sm text-foreground-muted">No phone number on file for this customer.</p>
      </div>
    )
  }

  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
      <button
        onClick={() => setIsOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface-secondary transition-colors"
      >
        <div className="flex items-center gap-2.5">
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

      {isOpen && (
        <>
          <div className="h-80 overflow-y-auto px-4 py-3 space-y-2.5 border-t border-border-default bg-surface">
            {isLoading ? (
              <div className="flex items-center justify-center h-full text-sm text-foreground-muted">
                Loading conversation...
              </div>
            ) : thread.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-foreground-muted">
                No WhatsApp messages yet.
              </div>
            ) : (
              thread.map(msg => (
                <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.direction === 'outbound'
                      ? 'bg-accent-500 text-white rounded-br-sm'
                      : 'bg-surface-elevated border border-border-default text-foreground rounded-bl-sm'
                  }`}>
                    <div className={`flex items-center gap-1.5 mb-0.5 text-xs ${msg.direction === 'outbound' ? 'text-white/70' : 'text-foreground-muted'}`}>
                      {msg.kind && <span className="font-semibold">{msg.kind}</span>}
                    </div>
                    {msg.body}
                    <div className={`flex items-center gap-1 mt-0.5 text-[11px] ${msg.direction === 'outbound' ? 'text-white/70' : 'text-foreground-muted'}`}>
                      <span>{formatTime(msg.sent_at)}</span>
                      {msg.direction === 'outbound' && msg.status === 'sent' && <Check className="w-3 h-3" />}
                      {msg.direction === 'outbound' && msg.status === 'failed' && <X className="w-3 h-3 text-red-300" />}
                    </div>
                  </div>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          <div className="px-4 py-3 border-t border-border-default space-y-3">
            {sendError && (
              <p className="text-xs text-red-600 dark:text-red-400 leading-snug">{sendError}</p>
            )}

            <div className="space-y-2">
              <AdminSelect
                value={selectedTemplate}
                onChange={(v) => { setSelectedTemplate(v); setTemplateVars({}); setSendError('') }}
                placeholder="Select a template…"
                options={Object.entries(groupedTemplates).flatMap(([cat, entries]) =>
                  entries.map(([key, tpl]) => ({
                    value: key,
                    label: tpl.label,
                    group: cat === 'marketing' ? 'Marketing' : 'Support',
                  }))
                )}
              />

              {activeTemplate && activeTemplate.fields.map(field => (
                <input
                  key={field}
                  type="text"
                  value={templateVars[field] || ''}
                  onChange={e => setTemplateVars(v => ({ ...v, [field]: e.target.value }))}
                  placeholder={field}
                  className="w-full px-3 py-2 rounded-xl border border-border-default bg-surface text-foreground placeholder:text-foreground-muted text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
                />
              ))}

              {activeTemplate && (
                <button
                  onClick={handleSendTemplate}
                  disabled={isSending}
                  className="w-full px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSending ? 'Sending…' : 'Send Template'}
                </button>
              )}
            </div>

            <div className="pt-3 border-t border-border-default">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={freeText}
                  onChange={e => setFreeText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendFreeText() } }}
                  placeholder="Free text message…"
                  className="flex-1 px-3.5 py-2 rounded-xl border border-border-default bg-surface text-foreground placeholder:text-foreground-muted text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
                />
                <button
                  onClick={handleSendFreeText}
                  disabled={isSending || !freeText.trim()}
                  className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-foreground-muted leading-snug">
                Free text only delivers within 24h of the customer&apos;s last message.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
