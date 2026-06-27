'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Send, ThumbsUp, ThumbsDown, X, Bot, User } from 'lucide-react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  id: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
}

type Verdict = 'helpful' | 'not_helpful'

const SAMPLE_PROMPTS = [
  "I'm building a wooden shelf — what fasteners do I need?",
  "Setting up shelving in my workshop, need brackets and bolts",
  "Need stainless screws for outdoor use",
  "Show me my recent orders",
  "Recommend products based on what I've bought",
]

const STATUS_STYLES: Record<string, string> = {
  delivered:   'bg-green-500/15 text-green-600 dark:text-green-400',
  shipped:     'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  processing:  'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
  confirmed:   'bg-accent-500/15 text-accent-600 dark:text-accent-400',
  pending:     'bg-foreground-muted/15 text-foreground-muted',
  cancelled:   'bg-red-500/15 text-red-600 dark:text-red-400',
}

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'product'; slug: string; name: string; price?: string }
  | { kind: 'order'; number: string; status: string; amount: string; date: string }

function tokenize(text: string): Token[] {
  const re = /\[\[(product):([^\]|]+)\|([^\]|]+)(?:\|([^\]]*))?\]\]|\[\[(order):([^\]|]+)\|([^\]|]+)\|([^\]|]+)\|([^\]]+)\]\]/g
  const tokens: Token[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push({ kind: 'text', value: text.slice(last, m.index) })
    if (m[1] === 'product') {
      tokens.push({ kind: 'product', slug: m[2], name: m[3], price: m[4] || undefined })
    } else {
      tokens.push({ kind: 'order', number: m[6], status: m[7], amount: m[8], date: m[9] })
    }
    last = m.index + m[0].length
  }
  if (last < text.length) tokens.push({ kind: 'text', value: text.slice(last) })
  return tokens
}

function parseContent(text: string, onClose: () => void): React.ReactNode {
  const tokens = tokenize(text)
  const textParts: React.ReactNode[] = []
  const productCards: { slug: string; name: string; price?: string }[] = []
  const orderCards: { number: string; status: string; amount: string; date: string }[] = []

  tokens.forEach((t, i) => {
    if (t.kind === 'text') {
      const v = t.value.trimEnd()
      if (v) textParts.push(<span key={i}>{v}</span>)
    } else if (t.kind === 'product') {
      productCards.push({ slug: t.slug, name: t.name, price: t.price })
    } else {
      orderCards.push({ number: t.number, status: t.status, amount: t.amount, date: t.date })
    }
  })

  const hasCards = productCards.length > 0 || orderCards.length > 0

  return (
    <div>
      <span className="whitespace-pre-wrap break-words">{textParts}</span>
      {hasCards && (
        <div className="mt-2 flex flex-col gap-2">
          {productCards.map(({ slug, name, price }) => (
            <Link
              key={slug}
              href={`/products/${slug}`}
              onClick={onClose}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border-default bg-surface hover:bg-surface-secondary hover:border-accent-500 transition-colors group"
            >
              <div className="w-7 h-7 rounded-lg bg-accent-500/10 flex items-center justify-center shrink-0">
                <svg className="w-3.5 h-3.5 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V11" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground group-hover:text-accent-600 dark:group-hover:text-accent-400 truncate">{name}</p>
                {price && <p className="text-xs text-foreground-muted">₹{price}</p>}
              </div>
              <svg className="w-3.5 h-3.5 text-foreground-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
          {orderCards.map(({ number, status, amount, date }) => (
            <Link
              key={number}
              href={`/account/orders`}
              onClick={onClose}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border-default bg-surface hover:bg-surface-secondary transition-colors group"
            >
              <div className="w-7 h-7 rounded-lg bg-foreground/5 flex items-center justify-center shrink-0">
                <svg className="w-3.5 h-3.5 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">#{number}</p>
                <p className="text-xs text-foreground-muted">{date} · ₹{amount}</p>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_STYLES[status] ?? STATUS_STYLES.pending}`}>
                {status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

let idCounter = 0
function uid() { return `msg-${++idCounter}-${Date.now()}` }

export default function CustomerChatModal({ isOpen, onClose }: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({})

  useEffect(() => {
    if (!isOpen) return
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      setInput('')
      setMessages([])
      setLoading(false)
      setVerdicts({})
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen) return
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [isOpen, onClose])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function sendFeedback(msgId: string, signal: 'helpful' | 'not_helpful') {
    setVerdicts(prev => ({ ...prev, [msgId]: signal }))
    try {
      await fetch('/api/ai-assistant/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ signal }),
      })
    } catch {}
  }

  async function submit(text?: string) {
    const q = (text ?? input).trim()
    if (!q || loading) return
    setInput('')

    const userMsg: ChatMessage = { role: 'user', content: q, id: uid() }
    const next = [...messages, userMsg]
    setMessages(next)
    setLoading(true)

    // Send last 10 messages as history (excluding the new user message we just added)
    const history = next.slice(-11, -1).map(m => ({ role: m.role, content: m.content }))

    try {
      const res = await fetch('/api/customer-agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: q, history }),
      })
      const data = await res.json()
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: res.ok ? (data.message || 'No response.') : (data.error || 'Something went wrong.'),
        id: uid(),
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Network error. Please try again.', id: uid() }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-30 transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', backgroundColor: 'rgba(15,23,42,0.45)' }}
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={`fixed left-1/2 -translate-x-1/2 top-3 sm:top-3 lg:top-5 z-50 w-[min(720px,calc(100vw-2rem))] transition-all duration-300 ease-out ${
          isOpen ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        <div className="bg-surface-elevated rounded-2xl border border-border-default shadow-2xl flex flex-col max-h-[min(700px,calc(100vh-4rem))]">

          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-default shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Jeffi Assistant</p>
              <p className="text-[11px] text-foreground-muted">Products · Orders · Recommendations</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {messages.length === 0 && !loading && (
              <div className="space-y-3">
                <p className="text-xs text-foreground-muted uppercase tracking-widest font-semibold">Try asking</p>
                {SAMPLE_PROMPTS.map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => submit(p)}
                    className="w-full text-left text-sm px-3 py-2.5 rounded-lg border border-border-default hover:border-accent-500 hover:bg-surface-secondary text-foreground-secondary transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                  msg.role === 'user'
                    ? 'bg-accent-500/15 text-accent-600 dark:text-accent-400'
                    : 'bg-gradient-to-br from-purple-500 to-blue-500 text-white'
                }`}>
                  {msg.role === 'user' ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                </div>
                <div className={`flex flex-col gap-1 max-w-[82%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    msg.role === 'user'
                      ? 'bg-accent-500 text-white rounded-tr-sm'
                      : 'bg-surface-secondary text-foreground rounded-tl-sm'
                  }`}>
                    {msg.role === 'assistant' ? parseContent(msg.content, onClose) : msg.content}
                  </div>
                  {msg.role === 'assistant' && (
                    <div className="flex items-center gap-1 px-1">
                      <button
                        type="button"
                        onClick={() => sendFeedback(msg.id, 'helpful')}
                        disabled={!!verdicts[msg.id]}
                        className={`p-1 rounded transition-colors ${
                          verdicts[msg.id] === 'helpful'
                            ? 'bg-accent-100 text-accent-600 dark:bg-accent-900/40 dark:text-accent-400'
                            : 'text-foreground-muted hover:text-accent-500 hover:bg-surface disabled:opacity-30'
                        }`}
                        aria-label="Helpful"
                      >
                        <ThumbsUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => sendFeedback(msg.id, 'not_helpful')}
                        disabled={!!verdicts[msg.id]}
                        className={`p-1 rounded transition-colors ${
                          verdicts[msg.id] === 'not_helpful'
                            ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                            : 'text-foreground-muted hover:text-red-500 hover:bg-surface disabled:opacity-30'
                        }`}
                        aria-label="Not helpful"
                      >
                        <ThumbsDown className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex gap-2.5">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shrink-0">
                  <Bot className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="bg-surface-secondary rounded-2xl rounded-tl-sm px-3.5 py-3 flex items-center gap-1">
                  {[0, 1, 2].map(i => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-foreground-muted animate-bounce"
                      style={{ animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border-default px-3 py-2.5 shrink-0">
            <form
              onSubmit={e => { e.preventDefault(); submit() }}
              className="flex items-end gap-2"
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
                }}
                placeholder="Ask about products or your orders…"
                rows={1}
                maxLength={2000}
                disabled={loading}
                className="flex-1 text-sm bg-transparent text-foreground placeholder:text-foreground-muted focus:outline-none resize-none py-1.5 max-h-32 overflow-y-auto"
                style={{ fieldSizing: 'content' } as React.CSSProperties}
              />
              <button
                type="submit"
                disabled={loading || input.trim().length === 0}
                className="p-2 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                aria-label="Send"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>

        </div>
      </div>
    </>
  )
}
