'use client'

import { useState, useEffect, useRef } from 'react'
import { useToast } from '@/contexts/ToastContext'

interface Message {
  id: string
  sender: 'user' | 'admin' | 'bot'
  message: string
  created_at?: string
  sender_name?: string
  is_closing?: boolean
}

interface Session {
  id: string
  status: string
  created_at: string
  admin_name?: string
}

const QUICK_REPLIES = [
  { label: 'Track my order', query: 'track my order' },
  { label: 'Payment status', query: 'payment status' },
  { label: 'Cancel an order', query: 'cancel order' },
  { label: 'Shipping info', query: 'shipping info' },
  { label: 'Return / Refund', query: 'refund' },
  { label: 'Latest order', query: 'latest order' },
]

export default function SupportChat() {
  const [mode, setMode] = useState<'bot' | 'live'>('bot')
  const [messages, setMessages] = useState<Message[]>([
    { id: 'welcome', sender: 'bot', message: "Hello! I'm the Jeffi Stores support bot.\n\nSelect a topic below and I'll look up your information right away." }
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
      const res = await fetch('/api/support/sessions')
      if (!res.ok) return
      const data = await res.json()
      if (data.session) {
        setSession(data.session)
        if (data.session.admin_name) setAdminName(data.session.admin_name)
        setMode('live')
        const msgsRes = await fetch(`/api/support/sessions/${data.session.id}/messages`)
        if (msgsRes.ok) {
          const msgsData = await msgsRes.json()
          if (msgsData.messages?.length) {
            setMessages(msgsData.messages.map((m: any) => ({ ...m })))
            lastMessageIdRef.current = msgsData.messages[msgsData.messages.length - 1].id
            if (msgsData.admin_name) setAdminName(msgsData.admin_name)
          }
        }
      }
    } catch {}
  }

  async function pollMessages(sessionId: string) {
    try {
      const res = await fetch(`/api/support/sessions/${sessionId}/messages`)
      if (!res.ok) return
      const data = await res.json()
      if (!data.messages?.length) return
      const latest = data.messages[data.messages.length - 1]
      if (latest.id !== lastMessageIdRef.current) {
        lastMessageIdRef.current = latest.id
        setMessages(data.messages.map((m: any) => ({ ...m })))
        if (data.admin_name) setAdminName(data.admin_name)
        if (latest.is_closing && latest.sender === 'admin') {
          setShowEndSessionPrompt(true)
        }
      }
    } catch {}
  }

  async function handleQuickReply(label: string, query: string) {
    if (isSending) return
    setUsedQuickReplies(prev => new Set(prev).add(label))
    const userMsg: Message = { id: Date.now().toString(), sender: 'user', message: label }
    setMessages(prev => [...prev, userMsg])
    setIsSending(true)
    try {
      const res = await fetch(`/api/support/bot?msg=${encodeURIComponent(query)}`, { credentials: 'include' })
      const data = await res.json()
      const reply = res.ok ? (data.reply || "I didn't get a response. Please try again.") : (data.error || 'Something went wrong.')
      setMessages(prev => [...prev, { id: Date.now().toString() + 'b', sender: 'bot', message: reply }])
      setShowConnectPrompt(true)
    } catch {
      setMessages(prev => [...prev, { id: Date.now().toString() + 'b', sender: 'bot', message: 'Something went wrong. Please try again.' }])
    } finally {
      setIsSending(false)
    }
  }

  async function connectToAgent() {
    setIsConnecting(true)
    try {
      const res = await fetch('/api/support/sessions', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSession(data.session)
      setMode('live')
      setShowConnectPrompt(false)
      setMessages([{ id: 'live-start', sender: 'bot', message: 'You are now connected to the support queue. A support agent will join shortly.' }])
      lastMessageIdRef.current = null
      showToast('Support agent notified. We will respond shortly.', 'success')
    } catch {
      showToast('Failed to connect. Please try again.', 'error')
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'closed' }),
      })
    } catch {}
    if (pollRef.current) clearInterval(pollRef.current)
    setSession(null)
    setAdminName(null)
    setMode('bot')
    setShowConnectPrompt(false)
    setShowEndSessionPrompt(false)
    setUsedQuickReplies(new Set())
    setMessages([
      { id: 'end', sender: 'bot', message: 'Chat ended. Select a topic below if you need further help.' }
    ])
    lastMessageIdRef.current = null
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendLiveMessage()
    }
  }

  const availableQuickReplies = QUICK_REPLIES.filter(qr => !usedQuickReplies.has(qr.label))

  return (
    <div className="relative flex flex-col w-full h-full bg-surface-elevated overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-primary-500 text-white shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-sm leading-none">
              {mode === 'bot' ? 'Support Bot' : (adminName ? adminName : 'Support Agent')}
            </p>
            <p className="text-white/70 text-xs mt-0.5">
              {mode === 'bot' ? 'Automated' : (adminName ? 'Jeffi Stores Support' : 'Connecting...')}
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

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
              msg.sender === 'user'
                ? 'bg-primary-500 text-white rounded-br-sm'
                : 'bg-surface border border-border-default text-foreground rounded-bl-sm'
            }`}>
              {msg.sender === 'admin' && (
                <p className="text-xs font-semibold text-primary-500 mb-1">
                  {(msg as any).sender_name || adminName || 'Support Agent'}
                </p>
              )}
              {msg.message}
            </div>
          </div>
        ))}

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
                onClick={() => handleQuickReply(qr.label, qr.query)}
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
              <p className="text-sm text-foreground mb-3">Still need help? Connect to a live support agent and we'll assist you directly.</p>
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
