'use client'

import { useState } from 'react'
import { useToast } from '@/contexts/ToastContext'

interface CustomerContactFormProps {
  customerId: string
}

export default function CustomerContactForm({ customerId }: CustomerContactFormProps) {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const { showToast } = useToast()

  async function handleSend() {
    if (!subject.trim() || !message.trim()) {
      showToast('Subject and message are required', 'error')
      return
    }

    setIsSending(true)
    try {
      const response = await fetch(`/api/customers/${customerId}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, message }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to send message')
      }

      showToast('Message sent successfully', 'success')
      setSubject('')
      setMessage('')
      setIsOpen(false)
    } catch (error: any) {
      showToast(error.message || 'Failed to send message. Please try again.', 'error')
    } finally {
      setIsSending(false)
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="w-full px-4 py-2.5 bg-zinc-700 hover:bg-zinc-600 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-white rounded-lg text-sm font-medium transition-colors text-left flex items-center gap-2"
      >
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        Send Message
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <h3 className="font-medium text-foreground text-sm">Compose Message</h3>
      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">Subject</label>
        <input
          type="text"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          disabled={isSending}
          placeholder="e.g. Regarding your recent order"
          className="w-full px-3 py-2 border border-border-default rounded-lg bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-50"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">Message</label>
        <textarea
          rows={5}
          value={message}
          onChange={e => setMessage(e.target.value)}
          disabled={isSending}
          placeholder="Write your message here..."
          className="w-full px-3 py-2 border border-border-default rounded-lg bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-50 resize-none"
        />
      </div>
      <div className="flex gap-3">
        <button
          onClick={handleSend}
          disabled={isSending}
          className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isSending ? 'Sending...' : 'Send'}
        </button>
        <button
          onClick={() => setIsOpen(false)}
          disabled={isSending}
          className="px-4 py-2 text-foreground-secondary hover:text-foreground text-sm font-medium transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
