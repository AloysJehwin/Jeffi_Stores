'use client'

import { useState } from 'react'
import RichTextEditor from '@/components/admin/RichTextEditor'

const TEMPLATES = [
  {
    id: 'delay_processing',
    label: 'Processing Delay',
    subject: 'Update on Your Order #{order_number}',
    body: `<p>Dear {customer_first_name},</p>
<p>Thank you for your order with Jeffi Stores.</p>
<p>We wanted to let you know that your order <strong>#{order_number}</strong> is currently in the final stages of processing. Our team is ensuring everything is packed perfectly before it heads your way.</p>
<p>We expect your order to be dispatched within the next 1–2 business days. You'll receive a shipping confirmation with tracking details as soon as it's on the way.</p>
<p>We sincerely appreciate your patience and look forward to getting your order to you soon.</p>
<p>Warm regards,<br>Team Jeffi Stores</p>`,
  },
  {
    id: 'delay_shipping',
    label: 'Shipping Delay',
    subject: 'Shipping Update for Your Order #{order_number}',
    body: `<p>Dear {customer_first_name},</p>
<p>We hope you're doing well. We're writing to share a brief update about your order <strong>#{order_number}</strong>.</p>
<p>Due to some logistical factors outside our control, there has been a slight delay in the delivery timeline. We sincerely apologise for any inconvenience this may have caused.</p>
<p>Your order is still on its way and we expect it to reach you soon. We'll keep you updated and notify you as soon as there's any further progress.</p>
<p>Thank you so much for your understanding — it truly means a lot to us.</p>
<p>Warm regards,<br>Team Jeffi Stores</p>`,
  },
  {
    id: 'out_of_stock',
    label: 'Item Unavailable',
    subject: 'Important Update About Your Order #{order_number}',
    body: `<p>Dear {customer_first_name},</p>
<p>Thank you for choosing Jeffi Stores. We're reaching out regarding your order <strong>#{order_number}</strong>.</p>
<p>Unfortunately, one of the items in your order has become temporarily unavailable due to higher-than-expected demand. We completely understand how frustrating this can be and we are truly sorry for the inconvenience.</p>
<p>Our team is actively working to source the item at the earliest. We will reach out to you as soon as it is available. In the meantime, if you'd prefer a full refund or would like to explore alternative options, please don't hesitate to reply to this email or contact our support team.</p>
<p>We value your trust in us and will do our best to make this right.</p>
<p>Warm regards,<br>Team Jeffi Stores</p>`,
  },
  {
    id: 'quality_check',
    label: 'Quality Check Hold',
    subject: 'Brief Hold on Your Order #{order_number}',
    body: `<p>Dear {customer_first_name},</p>
<p>We appreciate your order with Jeffi Stores.</p>
<p>We wanted to inform you that your order <strong>#{order_number}</strong> is currently undergoing our quality verification process. This is a standard check we carry out to ensure that every product we send meets our quality standards.</p>
<p>This should be resolved within 24 hours and your order will be dispatched promptly thereafter. We'll notify you as soon as it's on the way.</p>
<p>Thank you for your patience and continued trust in us.</p>
<p>Warm regards,<br>Team Jeffi Stores</p>`,
  },
  {
    id: 'custom',
    label: 'Custom Message',
    subject: 'Message from Jeffi Stores',
    body: '',
  },
]

interface Props {
  orderId: string
  orderNumber: string
  customerName: string
  customerEmail: string
}

export default function CustomerMailPanel({ orderId, orderNumber, customerName, customerEmail }: Props) {
  const [open, setOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATES[0].id)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const [scenarioPrompt, setScenarioPrompt] = useState('')
  const [scenarioLoading, setScenarioLoading] = useState(false)
  const [scenarioError, setScenarioError] = useState<string | null>(null)

  function applyTemplate(templateId: string) {
    const t = TEMPLATES.find(t => t.id === templateId)
    if (!t) return
    setSelectedTemplate(templateId)
    const filled = (s: string) => s.replace(/\{order_number\}/g, orderNumber)
    setSubject(filled(t.subject))
    setBody(filled(t.body))
  }

  function handleTemplateChange(templateId: string) {
    applyTemplate(templateId)
    setResult(null)
  }

  async function generateFromScenario() {
    if (scenarioPrompt.trim().length < 10 || scenarioLoading) return
    setScenarioLoading(true)
    setScenarioError(null)
    try {
      const ctx = `Order #${orderNumber} for ${customerName}.`
      const res = await fetch('/api/admin/ai-generate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: `${ctx} ${scenarioPrompt}`, subject }),
      })
      const data = await res.json() as { html?: string; error?: string }
      if (!res.ok || !data.html) {
        setScenarioError(data.error || 'Generation failed')
        return
      }
      setBody(data.html)
    } catch {
      setScenarioError('Network error')
    } finally {
      setScenarioLoading(false)
    }
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim()) return
    setSending(true)
    setResult(null)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/send-customer-mail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body, isHtml: true }),
      })
      const data = await res.json()
      if (res.ok) {
        setResult({ success: true, message: 'Email sent successfully.' })
        setSubject('')
        setBody('')
        setSelectedTemplate(TEMPLATES[0].id)
      } else {
        setResult({ success: false, message: data.error || 'Failed to send email.' })
      }
    } catch {
      setResult({ success: false, message: 'Network error. Please try again.' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); if (!open) applyTemplate(TEMPLATES[0].id) }}
        className="w-full px-6 py-4 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-accent-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <h2 className="text-lg font-semibold text-foreground">Customer Mail</h2>
        </div>
        <svg className={`w-4 h-4 text-foreground-muted transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-6 pb-6 border-t border-border-default pt-4 space-y-4">
          <div className="flex items-center gap-2 text-sm text-foreground-secondary">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span>To: <strong className="text-foreground">{customerName}</strong> &lt;{customerEmail}&gt;</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground-muted mb-1.5">Template</label>
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleTemplateChange(t.id)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    selectedTemplate === t.id
                      ? 'border-accent-500 bg-accent-500/10 text-accent-600 dark:text-accent-400'
                      : 'border-border-default bg-surface text-foreground-secondary hover:bg-surface-secondary'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {selectedTemplate === 'custom' && (
            <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg p-3 space-y-2">
              <label className="text-xs font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                Generate with AI
              </label>
              <textarea
                value={scenarioPrompt}
                onChange={e => setScenarioPrompt(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-border-secondary rounded text-sm bg-surface text-foreground resize-none"
                placeholder="Describe the situation — e.g. 'Apologize for shipping delay and offer 10% off next order'"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={generateFromScenario}
                  disabled={scenarioLoading || scenarioPrompt.trim().length < 10}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-500 hover:bg-violet-600 text-white rounded text-xs font-medium disabled:opacity-50"
                >
                  {scenarioLoading ? 'Generating…' : (body ? 'Regenerate' : 'Generate')}
                </button>
                {scenarioError && <span className="text-[11px] text-red-500">{scenarioError}</span>}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-foreground-muted mb-1.5">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="w-full border border-border-secondary rounded-lg px-3 py-2 text-sm bg-surface text-foreground focus:ring-accent-500 focus:border-accent-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground-muted mb-1.5">Message</label>
            <RichTextEditor value={body} onChange={setBody} placeholder="Write your message…" minHeight={260} />
            <p className="text-[11px] text-foreground-muted mt-1.5">
              Tokens like <code className="font-mono bg-surface-secondary px-1 rounded">{'{customer_first_name}'}</code> are replaced with the actual customer details when the email is sent.
            </p>
          </div>

          {result && (
            <div className={`px-4 py-3 rounded-lg text-sm ${
              result.success
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
            }`}>
              {result.message}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !subject.trim() || !body.trim()}
              className="bg-accent-500 hover:bg-accent-600 disabled:bg-gray-400 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors inline-flex items-center gap-2"
            >
              {sending ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Sending...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                  Send Email
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="bg-surface-secondary hover:bg-border-default text-foreground-secondary px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
