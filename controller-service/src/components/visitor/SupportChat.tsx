'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Headset, LogOut } from 'lucide-react'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { useToast } from '@/contexts/ToastContext'
import ChatShell from '@/components/chat/ChatShell'
import Composer, { type ReadyAttachment } from '@/components/chat/Composer'
import LanguagePicker from '@/components/chat/LanguagePicker'
import MessageList from '@/components/chat/MessageList'
import TypingIndicator from '@/components/chat/TypingIndicator'
import { useSupportChat } from '@/components/chat/useSupportChat'
import { isActive, isSupportLanguage, type SupportMessage } from '@/lib/support/types'

const STARTERS = [
  { label: 'Where is my order?', text: 'Where is my order?' },
  { label: 'Cancel an order', text: 'I want to cancel an order' },
  { label: 'Return or refund', text: 'I want to return an item' },
  { label: 'Change delivery address', text: 'I need to change the delivery address on my order' },
  { label: 'Payment issue', text: 'I have a problem with a payment' },
  { label: 'Talk to a person', text: 'I would like to talk to a person' },
]

const browserLang = () => {
  const l = typeof navigator !== 'undefined' ? navigator.language?.slice(0, 2) : null
  return isSupportLanguage(l) ? l : null
}

/** The customer's support chat: the store's assistant answers first, and a person joins when needed. */
export default function SupportChat({ portalHeader }: { portalHeader?: string } = {}) {
  const portal = portalHeader === 'business' ? 'business' : null
  const headers: Record<string, string> = portal ? { 'X-Auth-Portal': 'business' } : {}
  const storeName = useStoreConfig().identity.name || 'Support'
  const { showToast } = useToast()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [booting, setBooting] = useState(true)
  const [starting, setStarting] = useState(false)
  const [text, setText] = useState('')
  const [confirmEnd, setConfirmEnd] = useState(false)
  const queued = useRef<{ text: string; attachments: ReadyAttachment[] } | null>(null)

  const chat = useSupportChat({ sessionId, role: 'customer', portal })
  const s = chat.session

  useEffect(() => {
    fetch('/api/support/sessions?v=2', { credentials: 'include', headers })
      .then(r => (r.ok ? r.json() : null))
      .then(d => d?.session?.id && setSessionId(d.session.id))
      .catch(() => {})
      .finally(() => setBooting(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The first message is typed before the chat exists: send it once the new chat has loaded.
  useEffect(() => {
    if (!queued.current || !sessionId || chat.loading || s?.id !== sessionId) return
    const q = queued.current
    queued.current = null
    chat.send(q.text, q.attachments)
  }, [sessionId, chat.loading, s?.id, chat])

  const start = useCallback(
    async (first: string) => {
      if (starting) return
      setStarting(true)
      try {
        const r = await fetch('/api/support/sessions?v=2', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ lang: browserLang() }),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok || !d.session?.id) throw new Error(d?.error || 'Could not start the chat')
        queued.current = { text: first, attachments: [] }
        setSessionId(d.session.id)
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Could not start the chat', 'error')
      } finally {
        setStarting(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [starting]
  )

  const say = (t: string, attachments: ReadyAttachment[] = []) => {
    if (!sessionId || s?.status === 'closed') return start(t)
    chat.send(t, attachments)
  }

  const endChat = async () => {
    setConfirmEnd(false)
    if (!sessionId) return
    await fetch(`/api/support/sessions/${sessionId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ status: 'closed' }),
    }).catch(() => {})
    chat.setSession(x => (x ? { ...x, status: 'closed' } : x))
  }

  const decide = async (actionId: string, d: 'confirm' | 'decline') => {
    try {
      await chat.decide(actionId, d)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not do that', 'error')
    }
  }

  const human = s?.handler === 'human'
  const agentName = human ? s?.adminName : null
  const agentOnline = human && isActive(s?.adminLastSeenAt)
  const closed = s?.status === 'closed'
  const typingLabel = chat.typing ? (chat.typing.who === 'ai' ? 'Assistant is typing' : `${chat.typing.name || 'Agent'} is typing`) : null

  const isMine = useCallback((m: SupportMessage) => m.sender === 'customer', [])
  const labelFor = useCallback((m: SupportMessage) => (m.sender === 'customer' ? null : m.senderName), [])
  const showTicks = useCallback((m: SupportMessage) => m.sender === 'customer' && m.channel !== 'whatsapp', [])
  const orderHref = useCallback((id: string) => (portal ? `/business/account/orders/${id}` : `/account/orders/${id}`), [portal])

  const header = (
    <div className="flex items-center gap-2.5 px-3 sm:px-4 py-2.5 bg-primary-500 text-white">
      <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center shrink-0">{human ? <Headset className="w-[18px] h-[18px]" /> : <Bot className="w-[18px] h-[18px]" />}</div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm leading-tight truncate">{agentName || (human ? `${storeName} Support` : `${storeName} Assistant`)}</p>
        <p className="text-white/75 text-[11px] leading-tight truncate">
          {closed
            ? 'Chat ended'
            : human
              ? agentName
                ? agentOnline
                  ? 'Online'
                  : `${storeName} Support`
                : 'A support specialist will join shortly'
              : 'Replies instantly · a person can join anytime'}
          {s?.ticket ? ` · ${s.ticket}` : ''}
        </p>
      </div>
      {sessionId && !closed && <LanguagePicker tone="onPrimary" value={s?.customerLang ?? browserLang() ?? 'en'} onChange={chat.setLanguage} />}
      {sessionId && !closed && (
        <button type="button" onClick={() => setConfirmEnd(true)} title="End chat" aria-label="End chat" className="h-8 w-8 rounded-lg flex items-center justify-center text-white/85 hover:bg-white/15">
          <LogOut className="w-4 h-4" />
        </button>
      )}
    </div>
  )

  const welcome = (
    <div className="flex flex-col items-center text-center px-4 pt-6 pb-2 gap-3">
      <div className="w-12 h-12 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-500 flex items-center justify-center">
        <Bot className="w-6 h-6" />
      </div>
      <div>
        <p className="font-semibold text-foreground">Hi! How can we help?</p>
        <p className="text-xs text-foreground-muted mt-1 max-w-xs">
          Our assistant can track, cancel or return orders, change a delivery address and answer questions right away. Ask for a person anytime.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5 max-w-sm">
        {STARTERS.map(c => (
          <button
            key={c.label}
            type="button"
            disabled={starting}
            onClick={() => say(c.text)}
            className="px-3 py-1.5 text-xs font-medium rounded-full border border-primary-300 dark:border-primary-700 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/40 disabled:opacity-60"
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="relative h-full">
      <ChatShell
        header={header}
        banner={
          chat.error ? (
            <div className="px-4 py-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-900/40">{chat.error}</div>
          ) : undefined
        }
        composer={
          <Composer
            text={text}
            setText={setText}
            onSend={say}
            upload={sessionId && !closed ? chat.upload : undefined}
            onTyping={sessionId && !closed ? chat.notifyTyping : undefined}
            disabled={booting || starting}
            placeholder={closed ? 'Start a new chat…' : 'Type your message'}
          />
        }
      >
        <MessageList
          messages={sessionId ? chat.messages : []}
          isMine={isMine}
          labelFor={labelFor}
          showTicks={showTicks}
          onRetry={chat.retry}
          onDecide={decide}
          onChip={say}
          orderHref={orderHref}
          empty={booting || (sessionId && chat.loading) ? <p className="text-center text-xs text-foreground-muted pt-8">Loading…</p> : welcome}
          footer={
            <>
              {typingLabel && <TypingIndicator label={typingLabel} />}
              {closed && (
                <div className="flex flex-col items-center gap-2 py-3">
                  <span className="text-[11px] text-foreground-muted">This chat has ended. Write below to start a new one.</span>
                </div>
              )}
            </>
          }
        />
      </ChatShell>

      {confirmEnd && (
        <div className="absolute inset-0 bg-black/40 flex items-end justify-center pb-6 z-10" onClick={() => setConfirmEnd(false)}>
          <div className="bg-surface-elevated rounded-2xl shadow-2xl mx-4 p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <p className="font-semibold text-foreground text-sm mb-1">End this chat?</p>
            <p className="text-foreground-muted text-sm mb-4">You can start a new one anytime. The conversation stays in your history.</p>
            <div className="flex gap-3">
              <button type="button" onClick={endChat} className="flex-1 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-xl text-sm font-semibold">
                End chat
              </button>
              <button type="button" onClick={() => setConfirmEnd(false)} className="flex-1 py-2 border border-border-default text-foreground-secondary rounded-xl text-sm font-semibold hover:bg-surface-secondary">
                Keep chatting
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
