'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import type { BotPayload, BotOrderCard, BotAction, BotNavLink, BotChip } from '@/lib/support-bot'

interface Message {
  id: string
  sender: 'user' | 'admin' | 'bot'
  message: string        // plain text OR JSON-serialised BotPayload
  created_at?: string
  sender_name?: string
  is_closing?: boolean
  payload?: BotPayload   // parsed once, stored here to avoid re-parsing on every render
}

interface Session {
  id: string
  status: string
  created_at: string
  admin_name?: string
}

const QUICK_REPLIES = [
  { label: 'Track my order', query: 'track my order' },
  { label: 'My orders', query: 'all my orders' },
  { label: 'Cancel order', query: 'cancel an order' },
  { label: 'Return / Refund', query: 'return an order' },
  { label: 'Payment status', query: 'payment status' },
  { label: 'Latest order', query: 'latest order' },
]

const CLOSING_PHRASES = ['thank you for contacting', 'have a great day', 'your issue has been resolved', "don't hesitate to reach out"]

function parsePayload(message: string): BotPayload | null {
  try {
    const p = JSON.parse(message)
    if (p && typeof p.type === 'string') return p as BotPayload
    return null
  } catch {
    return null
  }
}

function attachPayloads(msgs: any[]): Message[] {
  return msgs.map(m => {
    if (m.sender === 'bot' || m.sender === 'admin') {
      const p = parsePayload(m.message)
      return { ...m, payload: p ?? undefined }
    }
    return { ...m }
  })
}

// ─── Sub-renderers ──────────────────────────────────────────────────────────

function OrderStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
    confirmed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    shipped: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
    dispatched: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
    delivered: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    returned: 'bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300',
  }
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${map[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  )
}

function NavIcon({ icon }: { icon?: BotNavLink['icon'] }) {
  if (icon === 'orders') return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  )
  if (icon === 'addresses') return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
  if (icon === 'invoices') return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
    </svg>
  )
  if (icon === 'track') return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    </svg>
  )
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  )
}

function ActionButton({ action, onQuery, compact }: { action: BotAction; onQuery: (q: string) => void; compact?: boolean }) {
  const router = useRouter()
  const cls = compact
    ? "px-2.5 py-1 text-xs font-medium rounded-lg border border-primary-300 dark:border-primary-700 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors"
    : "flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-primary-300 dark:border-primary-700 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors text-center"

  if (action.query) {
    return (
      <button className={cls} onClick={() => onQuery(action.query!)}>
        {action.label}
      </button>
    )
  }
  return (
    <button className={cls} onClick={() => router.push(action.url!)}>
      {action.label}
    </button>
  )
}

function OrderCard({ order, context, onClick }: { order: BotOrderCard; context: string; onClick?: () => void }) {
  const date = new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  const amt = `₹${Number(order.total_amount).toLocaleString('en-IN')}`

  const contextLabel: Record<string, string> = {
    cancel: 'Cancel this order',
    return: 'Return this order',
    track: 'Track this order',
    payment: 'View payment',
    view: 'View details',
  }

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 rounded-xl border border-border-default bg-surface hover:bg-surface-elevated hover:border-primary-300 dark:hover:border-primary-700 transition-all group"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-bold text-foreground">#{order.order_number}</span>
        <OrderStatusBadge status={order.status} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-foreground-muted">{date} · {amt}</span>
        <span className="text-xs text-primary-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
          {contextLabel[context] ?? 'Select'} →
        </span>
      </div>
    </button>
  )
}

interface PayloadRendererProps {
  payload: BotPayload
  onQuery: (q: string) => void
  onOrderSelect: (order: BotOrderCard, context: string) => void
}

function PayloadRenderer({ payload, onQuery, onOrderSelect }: PayloadRendererProps) {
  const router = useRouter()

  if (payload.type === 'text') {
    return <p className="text-sm leading-relaxed whitespace-pre-wrap">{payload.text}</p>
  }

  if (payload.type === 'text_actions') {
    return (
      <div className="space-y-2.5">
        <p className="text-sm leading-relaxed">{payload.text}</p>
        <div className="flex flex-wrap gap-1.5">
          {payload.actions.map((a, i) => (
            <ActionButton key={i} action={a} onQuery={onQuery} compact />
          ))}
        </div>
      </div>
    )
  }

  if (payload.type === 'order_list') {
    return (
      <div className="space-y-2">
        <p className="text-sm leading-relaxed">{payload.text}</p>
        <div className="space-y-1.5">
          {payload.orders.map(o => (
            <OrderCard
              key={o.order_number}
              order={o}
              context={payload.context}
              onClick={() => onOrderSelect(o, payload.context)}
            />
          ))}
        </div>
      </div>
    )
  }

  if (payload.type === 'order_detail') {
    const o = payload.order
    const date = new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    const amt = `₹${Number(o.total_amount).toLocaleString('en-IN')}`
    return (
      <div className="space-y-2.5">
        <div className="px-3 py-2.5 rounded-xl border border-border-default bg-surface space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground">#{o.order_number}</span>
            <OrderStatusBadge status={o.status} />
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <span className="text-foreground-muted">Date</span>
            <span className="text-foreground font-medium">{date}</span>
            <span className="text-foreground-muted">Total</span>
            <span className="text-foreground font-medium">{amt}</span>
            <span className="text-foreground-muted">Payment</span>
            <span className="text-foreground font-medium capitalize">{o.payment_status}</span>
            {o.tracking_number && (
              <>
                <span className="text-foreground-muted">Tracking</span>
                <span className="text-foreground font-medium text-[10px] truncate">{o.tracking_number}</span>
              </>
            )}
          </div>
        </div>
        {payload.actions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {payload.actions.map((a, i) => (
              <ActionButton key={i} action={a} onQuery={onQuery} compact />
            ))}
          </div>
        )}
      </div>
    )
  }

  if (payload.type === 'nav') {
    return (
      <div className="space-y-2">
        <p className="text-sm leading-relaxed">{payload.text}</p>
        <div className="space-y-1">
          {payload.links.map((link, i) => (
            <button
              key={i}
              onClick={() => link.query ? onQuery(link.query) : router.push(link.url!)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-surface hover:bg-surface-elevated border border-border-default hover:border-primary-300 dark:hover:border-primary-700 transition-all text-left"
            >
              <span className="text-primary-500 shrink-0"><NavIcon icon={link.icon} /></span>
              <span className="text-sm font-medium text-foreground">{link.label}</span>
              <svg className="w-3.5 h-3.5 ml-auto text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (payload.type === 'chips') {
    return (
      <div className="space-y-2.5">
        <p className="text-sm leading-relaxed">{payload.text}</p>
        <div className="flex flex-wrap gap-1.5">
          {payload.chips.map((c, i) => (
            <button
              key={i}
              onClick={() => onQuery(c.query)}
              className="px-3 py-1.5 text-xs font-medium rounded-full border border-primary-300 dark:border-primary-700 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors"
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return null
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function SupportChat({ portalHeader }: { portalHeader?: string } = {}) {
  const ph: Record<string, string> = portalHeader ? { 'X-Auth-Portal': portalHeader } : {}
  const [mode, setMode] = useState<'bot' | 'live'>('bot')
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'bot',
      message: '',
      payload: {
        type: 'chips',
        text: "hey! i'm Jeffi, your support assistant. what can i help you with?",
        chips: QUICK_REPLIES.map(qr => ({ label: qr.label, query: qr.query })),
      },
    }
  ])
  const [usedQuickReplies, setUsedQuickReplies] = useState<Set<string>>(new Set())
  const [input, setInput] = useState('')
  const [session, setSession] = useState<Session | null>(null)
  const [adminName, setAdminName] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [showConnectPrompt, setShowConnectPrompt] = useState(false)
  const [showEndSessionPrompt, setShowEndSessionPrompt] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastMessageIdRef = useRef<string | null>(null)
  const { showToast } = useToast()

  useEffect(() => {
    resumeSession()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, showConnectPrompt])

  useEffect(() => {
    if (mode === 'live' && session) {
      pollRef.current = setInterval(() => pollMessages(session.id), 3000)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [mode, session])

  async function resumeSession() {
    try {
      const res = await fetch('/api/support/sessions', { credentials: 'include', headers: ph })
      if (!res.ok) return
      const data = await res.json()
      if (!data.session) return

      const msgsRes = await fetch(`/api/support/sessions/${data.session.id}/messages`, { credentials: 'include', headers: ph })
      if (!msgsRes.ok) return
      const msgsData = await msgsRes.json()

      if (!msgsData.messages?.length) {
        await fetch(`/api/support/sessions/${data.session.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...ph },
          body: JSON.stringify({ status: 'closed' }),
          credentials: 'include',
        }).catch(() => {})
        return
      }

      setSession(data.session)
      if (data.session.admin_name) setAdminName(data.session.admin_name)
      setMode('live')
      setMessages(attachPayloads(msgsData.messages))
      lastMessageIdRef.current = msgsData.messages[msgsData.messages.length - 1].id
      if (msgsData.admin_name) setAdminName(msgsData.admin_name)
    } catch {}
  }

  async function pollMessages(sessionId: string) {
    try {
      const res = await fetch(`/api/support/sessions/${sessionId}/messages`, { credentials: 'include', headers: ph })
      if (!res.ok) return
      const data = await res.json()
      if (!data.messages?.length) return
      const latest = data.messages[data.messages.length - 1]
      if (latest.id !== lastMessageIdRef.current) {
        lastMessageIdRef.current = latest.id
        setMessages(attachPayloads(data.messages))
        if (data.admin_name) setAdminName(data.admin_name)
        if (latest.is_closing && latest.sender === 'admin') {
          setShowEndSessionPrompt(true)
        }
      }
    } catch {}
  }

  async function handleBotQuery(query: string) {
    if (isSending) return

    if (query === '__connect_agent__') {
      connectToAgent()
      return
    }

    setUsedQuickReplies(prev => new Set(prev).add(query))
    const userMsg: Message = { id: Date.now().toString(), sender: 'user', message: query }
    setMessages(prev => [...prev, userMsg])
    setIsSending(true)
    try {
      const res = await fetch(`/api/support/bot?msg=${encodeURIComponent(query)}`, { credentials: 'include', headers: ph })
      const data = await res.json()
      let payload: BotPayload
      if (res.ok && data.payload) {
        payload = data.payload
      } else {
        payload = { type: 'text', text: data.error || 'Something went wrong.' }
      }
      setMessages(prev => [...prev, { id: Date.now().toString() + 'b', sender: 'bot', message: '', payload }])
      setShowConnectPrompt(true)
    } catch {
      setMessages(prev => [...prev, {
        id: Date.now().toString() + 'b',
        sender: 'bot',
        message: '',
        payload: { type: 'text_actions', text: 'Something went wrong. Please try again.', actions: [{ label: 'Try Again', query }] },
      }])
    } finally {
      setIsSending(false)
    }
  }

  async function connectToAgent() {
    setIsConnecting(true)
    try {
      const res = await fetch('/api/support/sessions', { method: 'POST', credentials: 'include', headers: ph })
      const data = await res.json()
      if (res.status === 401) {
        showToast('Please sign in to connect to a support agent.', 'error')
        return
      }
      if (!res.ok) throw new Error(data.error || `Server error (${res.status})`)
      setSession(data.session)
      setMode('live')
      setShowConnectPrompt(false)
      setMessages([{
        id: 'live-start',
        sender: 'bot',
        message: '',
        payload: { type: 'text', text: "you're now in the support queue — an agent will join shortly. feel free to describe your issue while you wait." },
      }])
      lastMessageIdRef.current = null
      showToast('Support agent notified. We will respond shortly.', 'success')
    } catch (err: any) {
      showToast(err?.message || 'Failed to connect. Please try again.', 'error')
    } finally {
      setIsConnecting(false)
    }
  }

  async function sendLiveMessage() {
    if (!input.trim() || isSending || !session) return
    const text = input.trim()
    setInput('')
    setIsSending(true)
    try {
      const res = await fetch(`/api/support/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ph },
        body: JSON.stringify({ message: text }),
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessages(prev => [...prev, { ...data.message }])
      lastMessageIdRef.current = data.message.id
    } catch {
      showToast('Failed to send message.', 'error')
    } finally {
      setIsSending(false)
    }
  }

  async function endChat() {
    if (!session) return
    try {
      await fetch(`/api/support/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...ph },
        body: JSON.stringify({ status: 'closed' }),
        credentials: 'include',
      })
    } catch {}
    if (pollRef.current) clearInterval(pollRef.current)
    setSession(null)
    setAdminName(null)
    setMode('bot')
    setShowConnectPrompt(false)
    setShowEndSessionPrompt(false)
    setUsedQuickReplies(new Set())
    setMessages([{
      id: 'end',
      sender: 'bot',
      message: '',
      payload: {
        type: 'chips',
        text: 'chat ended. need more help?',
        chips: QUICK_REPLIES.map(qr => ({ label: qr.label, query: qr.query })),
      },
    }])
    lastMessageIdRef.current = null
  }

  function handleOrderSelect(order: BotOrderCard, context: string) {
    const contextMessages: Record<string, string> = {
      cancel: `i want to cancel order #${order.order_number}`,
      return: `i want to return order #${order.order_number}`,
      track: `track order #${order.order_number}`,
      payment: `payment details for order #${order.order_number}`,
      view: `details for order #${order.order_number}`,
    }
    const query = contextMessages[context] ?? `order #${order.order_number}`
    handleBotQuery(query)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (mode === 'live') sendLiveMessage()
    }
  }

  function renderMessage(msg: Message) {
    const isUser = msg.sender === 'user'

    if (isUser) {
      return (
        <div key={msg.id} className="flex justify-end">
          <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-br-sm text-sm leading-relaxed bg-primary-500 text-white">
            {msg.message}
          </div>
        </div>
      )
    }

    const payload = msg.payload ?? (msg.message ? parsePayload(msg.message) : null)
    const fallbackText = (!payload && msg.message) ? msg.message : null

    return (
      <div key={msg.id} className="flex justify-start">
        <div className="max-w-[90%] px-3.5 py-2.5 rounded-2xl rounded-bl-sm bg-surface border border-border-default text-foreground">
          {msg.sender === 'admin' && (
            <p className="text-xs font-semibold text-primary-500 mb-1.5">
              {(msg as any).sender_name || adminName || 'Support Agent'}
            </p>
          )}
          {payload ? (
            <PayloadRenderer
              payload={payload}
              onQuery={handleBotQuery}
              onOrderSelect={handleOrderSelect}
            />
          ) : (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{fallbackText}</p>
          )}
        </div>
      </div>
    )
  }

  const availableQuickReplies = QUICK_REPLIES.filter(qr => !usedQuickReplies.has(qr.query))

  return (
    <div className="relative flex flex-col w-full h-full bg-surface-elevated overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-primary-500 text-white shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-sm leading-none">
              {mode === 'bot' ? 'Jeffi' : (adminName ? adminName : 'Support Agent')}
            </p>
            <p className="text-white/70 text-xs mt-0.5">
              {mode === 'bot' ? 'Support Assistant' : (adminName ? 'Jeffi Stores Support' : 'Connecting...')}
            </p>
          </div>
        </div>
        {mode === 'live' && session && (
          <button
            onClick={endChat}
            className="text-white/80 hover:text-white text-xs px-3 py-1.5 rounded-lg border border-white/30 hover:bg-white/10 transition-colors"
          >
            End Chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map(msg => renderMessage(msg))}

        {isSending && mode === 'bot' && (
          <div className="flex justify-start">
            <div className="bg-surface border border-border-default rounded-2xl rounded-bl-sm px-3.5 py-2.5">
              <div className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 bg-foreground-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-foreground-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-foreground-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {mode === 'bot' && !isSending && availableQuickReplies.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {availableQuickReplies.map(qr => (
              <button
                key={qr.label}
                onClick={() => handleBotQuery(qr.query)}
                className="px-3.5 py-2 text-sm font-medium rounded-xl border border-primary-300 dark:border-primary-700 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors"
              >
                {qr.label}
              </button>
            ))}
          </div>
        )}

        {mode === 'bot' && showConnectPrompt && !isSending && (
          <div className="flex justify-start pt-1">
            <div className="bg-surface border border-border-default rounded-2xl rounded-bl-sm px-3.5 py-3 max-w-[85%]">
              <p className="text-sm text-foreground mb-3">Still need help? Connect to a live support agent and we&apos;ll assist you directly.</p>
              <button
                onClick={connectToAgent}
                disabled={isConnecting}
                className="w-full py-2 text-sm font-semibold text-white bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors disabled:opacity-50"
              >
                {isConnecting ? 'Connecting...' : 'Connect to Support Agent'}
              </button>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Live mode input */}
      {mode === 'live' && (
        <div className="px-4 pb-4 pt-2 border-t border-border-default shrink-0">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-border-default bg-surface text-foreground placeholder:text-foreground-muted text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
            <button
              onClick={sendLiveMessage}
              disabled={isSending || !input.trim()}
              className="px-4 py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-xl font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* End session prompt */}
      {showEndSessionPrompt && (
        <div className="absolute inset-0 bg-black/40 flex items-end justify-center pb-6 z-10">
          <div className="bg-surface-elevated rounded-2xl shadow-2xl mx-4 p-5 w-full max-w-sm">
            <p className="font-semibold text-foreground text-sm mb-1">Session resolved</p>
            <p className="text-foreground-muted text-sm mb-4">
              The support agent has marked your issue as resolved. Would you like to end this chat session?
            </p>
            <div className="flex gap-3">
              <button
                onClick={endChat}
                className="flex-1 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-xl text-sm font-semibold transition-colors"
              >
                End Chat
              </button>
              <button
                onClick={() => setShowEndSessionPrompt(false)}
                className="flex-1 py-2 border border-border-default text-foreground-secondary rounded-xl text-sm font-semibold hover:bg-surface-secondary transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
