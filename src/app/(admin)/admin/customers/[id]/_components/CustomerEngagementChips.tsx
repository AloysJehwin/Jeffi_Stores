'use client'

import { useState, useEffect, useCallback } from 'react'
import { Phone } from 'lucide-react'
import AdminSupportChat from '@/components/admin/AdminSupportChat'
import WhatsAppEngagement from '@/components/admin/WhatsAppEngagement'

interface Props {
  customerId: string
  phone: string | null
  marketingOptOut?: boolean
  autoOpenChat?: boolean
}

function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      {/* panel — large, fills most of the viewport */}
      <div className="relative z-10 w-full sm:max-w-3xl h-[92dvh] sm:h-[85dvh] bg-surface-elevated rounded-t-2xl sm:rounded-2xl shadow-2xl border border-border-default flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-default shrink-0">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-foreground-muted hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-surface-secondary"
            aria-label="Close"
          >
            {/* X */}
            <svg viewBox="0 0 20 20" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M4 4l12 12M16 4L4 16" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {/* content — fills remaining height, inner component scrolls */}
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  )
}

// Geometric headset icon (no emoji)
function HeadsetIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 11V9a7 7 0 0 1 14 0v2" />
      <rect x="3" y="11" width="3" height="4" rx="1.5" />
      <rect x="14" y="11" width="3" height="4" rx="1.5" />
      <path d="M17 15v1a3 3 0 0 1-3 3h-2" />
    </svg>
  )
}

function SupportChatChip({ customerId, autoOpen }: { customerId: string; autoOpen?: boolean }) {
  const [open, setOpen] = useState(!!autoOpen)
  const [hasActive, setHasActive] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const res = await fetch(`/api/admin/support/sessions?customerId=${customerId}`, { credentials: 'include' })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setHasActive(!!(data.session && data.session.status === 'open'))
      } catch {
        /* ignore */
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [customerId])

  const handleClose = useCallback(() => setOpen(false), [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex flex-col items-start gap-2 px-4 py-3 rounded-xl border border-border-default bg-surface-secondary hover:bg-surface-primary hover:border-border-strong hover:shadow-sm transition-all group w-full"
      >
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <HeadsetIcon className="w-4 h-4 text-foreground-secondary group-hover:text-foreground transition-colors" />
            <span className="text-xs font-semibold text-foreground">Support Chat</span>
          </div>
          <svg
            viewBox="0 0 16 16"
            className="w-3 h-3 text-foreground-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasActive ? 'bg-green-500' : 'bg-foreground-muted/30'}`}
          />
          <span className="text-[10px] text-foreground-muted">
            {hasActive ? 'Active session' : 'No active session'}
          </span>
        </div>
      </button>

      <Modal open={open} onClose={handleClose} title="Support Chat">
        <AdminSupportChat customerId={customerId} autoOpen />
      </Modal>
    </>
  )
}

function WhatsAppChip({
  customerId,
  phone,
  marketingOptOut,
}: {
  customerId: string
  phone: string | null
  marketingOptOut?: boolean
}) {
  const [open, setOpen] = useState(false)
  const hasPhone = !!phone
  const handleClose = useCallback(() => setOpen(false), [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex flex-col items-start gap-2 px-4 py-3 rounded-xl border border-border-default bg-surface-secondary hover:bg-surface-primary hover:border-border-strong hover:shadow-sm transition-all group w-full"
      >
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-green-600 dark:text-green-400 group-hover:text-green-700 dark:group-hover:text-green-300 transition-colors" />
            <span className="text-xs font-semibold text-foreground">WhatsApp</span>
          </div>
          <svg
            viewBox="0 0 16 16"
            className="w-3 h-3 text-foreground-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasPhone ? 'bg-green-500' : 'bg-foreground-muted/30'}`}
          />
          <span className="text-[10px] text-foreground-muted truncate max-w-[90px]">
            {hasPhone ? phone : 'No number on file'}
          </span>
        </div>
      </button>

      <Modal open={open} onClose={handleClose} title="WhatsApp Engagement">
        <WhatsAppEngagement customerId={customerId} phone={phone} marketingOptOut={marketingOptOut} forceOpen />
      </Modal>
    </>
  )
}

export default function CustomerEngagementChips({ customerId, phone, marketingOptOut, autoOpenChat }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 mb-5">
      <SupportChatChip customerId={customerId} autoOpen={autoOpenChat} />
      <WhatsAppChip customerId={customerId} phone={phone} marketingOptOut={marketingOptOut} />
    </div>
  )
}
