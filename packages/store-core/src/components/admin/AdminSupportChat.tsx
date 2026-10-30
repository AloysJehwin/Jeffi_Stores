'use client'

import { useEffect, useState } from 'react'
import SupportConversation from '@/components/admin/support/SupportConversation'
import type { SupportSession } from '@/lib/support/types'

/** The customer page's support chat: their open conversation, else the latest one (read-only). */
export default function AdminSupportChat({ customerId }: { customerId: string; autoOpen?: boolean }) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'none' | 'ready'>('loading')

  useEffect(() => {
    let off = false
    const find = async (filter: 'open' | 'closed') => {
      const r = await fetch(`/api/admin/support/sessions?customerId=${customerId}&filter=${filter}&limit=1`).catch(() => null)
      const d = r?.ok ? await r.json() : null
      return (d?.sessions as SupportSession[] | undefined)?.[0]?.id ?? null
    }
    ;(async () => {
      const id = (await find('open')) ?? (await find('closed'))
      if (off) return
      setSessionId(id)
      setState(id ? 'ready' : 'none')
    })()
    return () => {
      off = true
    }
  }, [customerId])

  if (state === 'loading') return <div className="h-full flex items-center justify-center text-sm text-foreground-muted">Loading…</div>
  if (!sessionId) return <div className="h-full flex items-center justify-center text-sm text-foreground-muted p-6 text-center">This customer has no support chats yet.</div>
  return <SupportConversation sessionId={sessionId} inCustomerPage />
}
