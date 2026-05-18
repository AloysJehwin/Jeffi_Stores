'use client'

import { useState } from 'react'

const TEMPLATES = [
  {
    id: 'delay_processing',
    label: 'Processing Delay',
    subject: 'Update on Your Order #{order_number}',
    body: `Dear {customer_name},

Thank you for your order with Jeffi Stores.

We wanted to let you know that your order #{order_number} is currently in the final stages of processing. Our team is ensuring everything is packed perfectly before it heads your way.

We expect your order to be dispatched within the next 1–2 business days. You'll receive a shipping confirmation with tracking details as soon as it's on the way.

We sincerely appreciate your patience and look forward to getting your order to you soon.

Warm regards,
Team Jeffi Stores`,
  },
  {
    id: 'delay_shipping',
    label: 'Shipping Delay',
    subject: 'Shipping Update for Your Order #{order_number}',
    body: `Dear {customer_name},

We hope you're doing well. We're writing to share a brief update about your order #{order_number}.

Due to some logistical factors outside our control, there has been a slight delay in the delivery timeline. We sincerely apologise for any inconvenience this may have caused.

Your order is still on its way and we expect it to reach you within {estimated_date}. We'll keep you updated and notify you as soon as there's any further progress.

Thank you so much for your understanding — it truly means a lot to us.

Warm regards,
Team Jeffi Stores`,
  },
  {
    id: 'out_of_stock',
    label: 'Item Unavailable',
    subject: 'Important Update About Your Order #{order_number}',
    body: `Dear {customer_name},

Thank you for choosing Jeffi Stores. We're reaching out regarding your order #{order_number}.

Unfortunately, one of the items in your order has become temporarily unavailable due to higher-than-expected demand. We completely understand how frustrating this can be and we are truly sorry for the inconvenience.

Our team is actively working to source the item at the earliest. We will reach out to you as soon as it is available. In the meantime, if you'd prefer a full refund or would like to explore alternative options, please don't hesitate to reply to this email or contact our support team.

We value your trust in us and will do our best to make this right.

Warm regards,
Team Jeffi Stores`,
  },
  {
    id: 'quality_check',
    label: 'Quality Check Hold',
    subject: 'Brief Hold on Your Order #{order_number}',
    body: `Dear {customer_name},

We appreciate your order with Jeffi Stores.

We wanted to inform you that your order #{order_number} is currently undergoing our quality verification process. This is a standard check we carry out to ensure that every product we send meets our quality standards.

This should be resolved within 24 hours and your order will be dispatched promptly thereafter. We'll notify you as soon as it's on the way.

Thank you for your patience and continued trust in us.

Warm regards,
Team Jeffi Stores`,
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

  function applyTemplate(templateId: string) {
    const t = TEMPLATES.find(t => t.id === templateId)
    if (!t) return
    setSelectedTemplate(templateId)
    const filled = (s: string) =>
      s
        .replace(/\{order_number\}/g, orderNumber)
        .replace(/\{customer_name\}/g, customerName)
        .replace(/\{estimated_date\}/g, '')
    setSubject(filled(t.subject))
    setBody(filled(t.body))
  }

  function handleTemplateChange(templateId: string) {
    applyTemplate(templateId)
    setResult(null)
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim()) return
    setSending(true)
    setResult(null)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/send-customer-mail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
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
            <textarea
              rows={10}
              value={body}
              onChange={e => setBody(e.target.value)}
              className="w-full border border-border-secondary rounded-lg px-3 py-2 text-sm bg-surface text-foreground focus:ring-accent-500 focus:border-accent-500 font-mono resize-y"
            />
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
