'use client'

import { useState, useEffect, useRef } from 'react'

interface Message {
  id: string
  sender: 'user' | 'admin' | 'bot'
  message: string
  created_at?: string
}

interface Session {
  id: string
  status: string
  created_at: string
  admin_name?: string
}

interface Props {
  customerId: string
  autoOpen?: boolean
}

const QUICK_REPLIES = [
  {
    category: 'Greeting',
    replies: [
      'Hello! Thank you for reaching out to Jeffi Stores support. How can I help you today?',
      'Hi! I\'m here to assist you. Let me look into this for you right away.',
    ],
  },
  {
    category: 'Order',
    replies: [
      'I can see your order in our system. Could you please share your order number so I can check the details?',
      'Your order has been confirmed and is being processed. You will receive a shipping update shortly.',
      'Your order has been shipped. You should receive it within 3–7 business days.',
      'I have escalated your order issue to our fulfillment team. You will hear back within 24 hours.',
    ],
  },
  {
    category: 'Payment',
    replies: [
      'Your payment has been successfully received and your order is confirmed.',
      'I can see a payment discrepancy. Our finance team will review and resolve it within 2 business days.',
      'Refunds are processed within 5–7 business days and credited to the original payment method.',
    ],
  },
  {
    category: 'Cancellation',
    replies: [
      'I have raised a cancellation request for your order. Our team will process it within 24 hours.',
      'Unfortunately, your order has already been shipped and cannot be cancelled. Please refuse delivery for a return.',
    ],
  },
  {
    category: 'Closing',
    replies: [
      'Is there anything else I can help you with?',
      'Thank you for contacting Jeffi Stores support. Have a great day!',
      'Your issue has been resolved. Please don\'t hesitate to reach out if you need further assistance.',
    ],
  },
]

export default function AdminSupportChat({ customerId, autoOpen = false }: Props) {
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isOpen, setIsOpen] = useState(autoOpen)
  const [isLoading, setIsLoading] = useState(true)
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const [activeCategory, setActiveCategory] = useState(QUICK_REPLIES[0].category)
  const [isClosingReply, setIsClosingReply] = useState(false)
  const [adminUsername, setAdminUsername] = useState<string>('')
  const [sessionClosed, setSessionClosed] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastMessageIdRef = useRef<string | null>(null)
  const greetedRef = useRef(false)

  useEffect(() => {
    loadSession()
  }, [customerId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (session) {
      pollRef.current = setInterval(() => pollMessages(session.id), 3000)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [session])

  async function loadSession() {
    setIsLoading(true)
    try {
      const [sessionRes, meRes] = await Promise.all([
        fetch(`/api/admin/support/customers/${customerId}`),
        fetch('/api/admin/check-session'),
      ])
      const meData = await meRes.json()
      const username = meData.user?.username || ''
      setAdminUsername(username)

      if (!sessionRes.ok) { setIsLoading(false); return }
      const data = await sessionRes.json()
      if (data.session) {
        const existingAdmin = data.session.admin_name
        if (existingAdmin && existingAdmin !== username) {
          setSession(data.session)
          setSessionClosed(false)
          setMessages([])
          setIsLoading(false)
          return
        }
        setSession(data.session)
        await loadMessages(data.session.id, username)
      }
    } catch {}
    setIsLoading(false)
  }

  async function loadMessages(sessionId: string, username?: string) {
    try {
      const res = await fetch(`/api/admin/support/sessions/${sessionId}/messages`)
      if (!res.ok) return
      const data = await res.json()
      if (data.messages?.length) {
        setMessages(data.messages)
        lastMessageIdRef.current = data.messages[data.messages.length - 1].id
        return
      }
      const adminUser = username || adminUsername
      if (adminUser && !greetedRef.current) {
        greetedRef.current = true
        await autoGreet(sessionId, adminUser)
      }
    } catch {}
  }

  async function autoGreet(sessionId: string, username: string) {
    const greeting = `Hi! I'm ${username} from Jeffi Stores support. How can I help you today?`
    try {
      const res = await fetch(`/api/admin/support/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: greeting }),
      })
      const data = await res.json()
      if (res.ok) {
        setMessages([data.message])
        lastMessageIdRef.current = data.message.id
      }
    } catch {}
  }

  async function pollMessages(sessionId: string) {
    try {
      const [msgsRes, sessionRes] = await Promise.all([
        fetch(`/api/admin/support/sessions/${sessionId}/messages`),
        fetch(`/api/admin/support/customers/${customerId}`),
      ])

      if (sessionRes.ok) {
        const sessionData = await sessionRes.json()
        if (!sessionData.session || sessionData.session.status !== 'open') {
          if (pollRef.current) clearInterval(pollRef.current)
          setSessionClosed(true)
          setShowQuickReplies(false)
        }
      }

      if (!msgsRes.ok) return
      const data = await msgsRes.json()
      if (!data.messages?.length) return
      const latest = data.messages[data.messages.length - 1]
      if (latest.id !== lastMessageIdRef.current) {
        lastMessageIdRef.current = latest.id
        setMessages(data.messages)
      }
    } catch {}
  }

  async function sendMessage(text?: string, isClosing = false) {
    const msg = (text ?? input).trim()
    if (!msg || isSending || !session) return
    setInput('')
    setIsClosingReply(false)
    setShowQuickReplies(false)
    setIsSending(true)
    try {
      const res = await fetch(`/api/admin/support/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, isClosingMessage: isClosing }),
      })
      const data = await res.json()
      if (res.ok) {
        setMessages(prev => [...prev, { ...data.message }])
        lastMessageIdRef.current = data.message.id
      }
    } catch {}
    setIsSending(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(undefined, isClosingReply)
    }
  }

  function useQuickReply(text: string) {
    setInput(text)
    setIsClosingReply(activeCategory === 'Closing')
    setShowQuickReplies(false)
  }

  if (isLoading) {
    return (
      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <h2 className="font-semibold text-foreground mb-2">Support Chat</h2>
        <div className="text-sm text-foreground-muted">Checking for active support session...</div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-foreground-muted" />
          <h2 className="font-semibold text-foreground">Support Chat</h2>
        </div>
        <p className="text-sm text-foreground-muted">No active support session for this customer.</p>
      </div>
    )
  }

  const takenByOther = session.admin_name && session.admin_name !== adminUsername

  if (takenByOther) {
    return (
      <div className="bg-surface-elevated rounded-xl border border-amber-400/40 p-5">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          <h2 className="font-semibold text-foreground">Support Chat</h2>
        </div>
        <p className="text-sm text-foreground-muted">
          This session is already being handled by <span className="font-semibold text-foreground">{session.admin_name}</span>.
        </p>
      </div>
    )
  }

  const activeCategoryReplies = QUICK_REPLIES.find(c => c.category === activeCategory)?.replies ?? []

  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
      <button
        onClick={() => setIsOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface-secondary transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className={`w-2.5 h-2.5 rounded-full ${sessionClosed ? 'bg-foreground-muted' : 'bg-green-500 animate-pulse'}`} />
          <span className="font-semibold text-foreground">
            {sessionClosed ? 'Support Chat (Ended)' : 'Live Support Chat'}
          </span>
          <span className="text-xs text-foreground-muted bg-surface px-2 py-0.5 rounded-full border border-border-default">
            {messages.length} message{messages.length !== 1 ? 's' : ''}
          </span>
        </div>
        <svg className={`w-4 h-4 text-foreground-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div className="h-80 overflow-y-auto px-4 py-3 space-y-2.5 border-t border-border-default bg-surface">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-foreground-muted">
                No messages yet. The customer will see your reply in their chat.
              </div>
            ) : (
              messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.sender === 'admin' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.sender === 'admin'
                      ? 'bg-accent-500 text-white rounded-br-sm'
                      : msg.sender === 'bot'
                      ? 'bg-surface-secondary border border-border-default text-foreground-muted rounded-bl-sm italic'
                      : 'bg-surface-elevated border border-border-default text-foreground rounded-bl-sm'
                  }`}>
                    {msg.sender === 'user' && (
                      <p className="text-xs font-semibold text-accent-500 mb-0.5">Customer</p>
                    )}
                    {msg.message}
                  </div>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {showQuickReplies && !sessionClosed && (
            <div className="border-t border-border-default bg-surface-secondary">
              <div className="flex gap-1 px-4 pt-3 pb-2 overflow-x-auto">
                {QUICK_REPLIES.map(cat => (
                  <button
                    key={cat.category}
                    onClick={() => setActiveCategory(cat.category)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                      activeCategory === cat.category
                        ? 'bg-accent-500 text-white'
                        : 'bg-surface border border-border-default text-foreground-secondary hover:border-accent-400'
                    }`}
                  >
                    {cat.category}
                  </button>
                ))}
              </div>
              <div className="px-4 pb-3 space-y-1.5 max-h-44 overflow-y-auto">
                {activeCategoryReplies.map((reply, i) => (
                  <button
                    key={i}
                    onClick={() => useQuickReply(reply)}
                    className="w-full text-left text-sm px-3 py-2 rounded-lg border border-border-default bg-surface hover:border-accent-400 hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors text-foreground leading-snug"
                  >
                    {reply}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="px-4 py-3 border-t border-border-default">
            {sessionClosed ? (
              <p className="text-sm text-foreground-muted text-center py-1">This session has been closed by the customer.</p>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowQuickReplies(v => !v)}
                  title="Quick replies"
                  className={`px-3 py-2 rounded-xl border text-sm font-semibold transition-colors ${
                    showQuickReplies
                      ? 'bg-accent-500 border-accent-500 text-white'
                      : 'border-border-default text-foreground-secondary hover:border-accent-400 hover:text-accent-500'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </button>
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Reply to customer..."
                  className="flex-1 px-3.5 py-2 rounded-xl border border-border-default bg-surface text-foreground placeholder:text-foreground-muted text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
                />
                <button
                  onClick={() => sendMessage(undefined, isClosingReply)}
                  disabled={isSending || !input.trim()}
                  className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
