'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Globe, MessageSquareText, Smartphone, Sparkles, Undo2, UserRoundCheck, X } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { useToast } from '@/contexts/ToastContext'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import ChatShell from '@/components/chat/ChatShell'
import Composer, { type ComposerHandle, type ReadyAttachment } from '@/components/chat/Composer'
import LanguagePicker from '@/components/chat/LanguagePicker'
import MessageList from '@/components/chat/MessageList'
import PresenceBadge from '@/components/chat/PresenceBadge'
import TypingIndicator from '@/components/chat/TypingIndicator'
import { useSupportChat } from '@/components/chat/useSupportChat'
import { languageLabel, type SupportChannel, type SupportMessage, type SupportSession } from '@/lib/support/types'

const QUICK_REPLIES = [
  { category: 'Greeting', replies: ['Hello! Thank you for reaching out to {store} support. How can I help you today?', "Hi! I'm here to help. Let me look into this for you right away."] },
  {
    category: 'Order',
    replies: [
      'Could you share your order number so I can check the details?',
      'Your order is confirmed and being processed. You will get a shipping update shortly.',
      'Your order has shipped. It should reach you within 3–7 business days.',
      'I have escalated this to our fulfilment team. You will hear back within 24 hours.',
    ],
  },
  {
    category: 'Payment',
    replies: [
      'Your payment has been received and your order is confirmed.',
      'I can see a payment discrepancy. Our finance team will resolve it within 2 business days.',
      'Refunds are processed within 5–7 business days to the original payment method.',
    ],
  },
  { category: 'Closing', replies: ['Is there anything else I can help you with?', 'Thank you for contacting {store} support. Have a great day!'] },
]

export const CHANNEL_ICON: Record<SupportChannel, typeof Globe> = { web: Globe, app: Smartphone, whatsapp: MessageSquareText }
export const CHANNEL_LABEL: Record<SupportChannel, string> = { web: 'Website', app: 'App', whatsapp: 'WhatsApp' }

function QuickReplies({ onPick }: { onPick: (t: string) => void }) {
  const [open, setOpen] = useState(false)
  const [cat, setCat] = useState(QUICK_REPLIES[0].category)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [open])
  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title="Quick replies"
        aria-label="Quick replies"
        className="h-10 w-10 rounded-full flex items-center justify-center text-foreground-secondary hover:bg-surface-secondary"
      >
        <MessageSquareText className="w-5 h-5" />
      </button>
      {open && (
        <div className="absolute bottom-12 left-0 z-20 w-[min(22rem,80vw)] rounded-xl border border-border-default bg-surface-elevated shadow-xl overflow-hidden">
          <div className="flex gap-1 overflow-x-auto px-2 pt-2">
            {QUICK_REPLIES.map(q => (
              <button
                key={q.category}
                type="button"
                onClick={() => setCat(q.category)}
                className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium ${cat === q.category ? 'bg-primary-500 text-white' : 'bg-surface-secondary text-foreground-secondary'}`}
              >
                {q.category}
              </button>
            ))}
          </div>
          <div className="max-h-56 overflow-y-auto p-2 space-y-1">
            {QUICK_REPLIES.find(q => q.category === cat)?.replies.map(r => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  onPick(r)
                  setOpen(false)
                }}
                className="w-full text-left text-xs text-foreground-secondary hover:text-foreground hover:bg-surface-secondary rounded-lg px-2.5 py-2"
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface Props {
  sessionId: string
  /** The inbox keeps its row in step with what this pane learns. */
  onSession?: (s: SupportSession) => void
  onClose?: () => void
  /** Hide the customer link (already on the customer's page). */
  inCustomerPage?: boolean
  onPickFromDrive?: () => Promise<ReadyAttachment[] | null>
}

/** One support conversation for an agent: the chat, who's handling it, and what they can do. */
export default function SupportConversation({ sessionId, onSession, onClose, inCustomerPage, onPickFromDrive }: Props) {
  const chat = useSupportChat({ sessionId, role: 'admin' })
  const s = chat.session
  const canWrite = useCanWrite('customers')
  const storeName = useStoreConfig().identity.name
  const { showToast } = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const composer = useRef<ComposerHandle>(null)

  useEffect(() => {
    if (s) onSession?.(s)
  }, [s, onSession])

  const act = async (what: 'join' | 'handback' | 'close') => {
    setBusy(what)
    try {
      const r =
        what === 'close'
          ? await fetch(`/api/admin/support/sessions/${sessionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'closed' }) })
          : await fetch(`/api/admin/support/sessions/${sessionId}/${what}`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || 'Could not do that')
      if (d.session) chat.setSession(() => d.session)
      if (what === 'close') chat.setSession(x => (x ? { ...x, status: 'closed' } : x))
      if (what === 'join') composer.current?.focus()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not do that', 'error')
    } finally {
      setBusy(null)
    }
  }

  const upload = useCallback(
    (file: File, onProgress: (pct: number) => void) => chat.upload(file, onProgress),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat.upload]
  )

  const isMine = useCallback((m: SupportMessage) => m.sender !== 'customer' && m.sender !== 'system', [])
  const labelFor = useCallback((m: SupportMessage) => (m.sender === 'customer' ? null : m.senderName === 'You' ? null : m.senderName), [])
  const showTicks = useCallback((m: SupportMessage) => m.sender !== 'customer' && m.sender !== 'system', [])
  const orderHref = useCallback((id: string) => ap(`/admin/orders/${id}`), [])

  if (chat.error && !s) return <div className="h-full flex items-center justify-center text-sm text-foreground-muted p-6 text-center">{chat.error}</div>
  if (!s) return <div className="h-full flex items-center justify-center text-sm text-foreground-muted">Loading…</div>

  const closed = s.status === 'closed'
  const mineToHandle = s.handler === 'human' && s.assignedAdminId === chat.me
  const someoneElse = s.handler === 'human' && s.assignedAdminId && s.assignedAdminId !== chat.me
  const ChannelIcon = CHANNEL_ICON[s.channel]
  const waClosed = s.channel === 'whatsapp' && s.waWindowExpiresAt && new Date(s.waWindowExpiresAt).getTime() < Date.now()
  const lastCustomer = [...chat.messages].reverse().find(m => m.sender === 'customer')?.text ?? ''
  const typingLabel = chat.typing ? (chat.typing.who === 'ai' ? 'Assistant is replying' : chat.typing.who === 'customer' ? `${s.customer.name} is typing` : null) : null

  const header = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5 border-b border-border-default bg-surface-elevated">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          {inCustomerPage || !s.customer.id ? (
            <p className="font-semibold text-sm text-foreground truncate">{s.customer.name}</p>
          ) : (
            <a href={ap(`/admin/customers/${s.customer.id}/view`)} className="font-semibold text-sm text-foreground truncate hover:underline">
              {s.customer.name}
            </a>
          )}
          <span title={CHANNEL_LABEL[s.channel]} className="text-foreground-muted">
            <ChannelIcon className="w-3.5 h-3.5" />
          </span>
          {s.ticket && <span className="text-[11px] text-foreground-muted font-mono">{s.ticket}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
          {s.channel === 'whatsapp' ? (
            <span className="text-[11px] text-foreground-muted">{s.customer.phone ?? 'WhatsApp'}</span>
          ) : (
            <PresenceBadge lastSeenAt={s.customerLastSeenAt} />
          )}
          <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${s.handler === 'ai' ? 'text-violet-600 dark:text-violet-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {s.handler === 'ai' ? <Bot className="w-3.5 h-3.5" /> : <UserRoundCheck className="w-3.5 h-3.5" />}
            {closed ? 'Closed' : s.handler === 'ai' ? 'Assistant is handling' : mineToHandle ? 'You are handling' : s.adminName ? `${s.adminName} is handling` : 'Waiting for an agent'}
          </span>
          {s.customerLang && s.customerLang !== chat.lang && <span className="text-[11px] text-foreground-muted">Customer writes in {languageLabel(s.customerLang)}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <LanguagePicker value={chat.lang} onChange={chat.setLanguage} title="Your chat language" />
        {!closed && canWrite && !mineToHandle && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => act('join')}
            className="h-8 px-3 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-xs font-semibold disabled:opacity-60 inline-flex items-center gap-1"
          >
            <UserRoundCheck className="w-3.5 h-3.5" />
            {someoneElse ? 'Take over' : 'Join chat'}
          </button>
        )}
        {!closed && canWrite && s.handler === 'human' && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => act('handback')}
            title="Hand back to the assistant"
            aria-label="Hand back to the assistant"
            className="h-8 w-8 rounded-lg border border-border-default flex items-center justify-center text-foreground-secondary hover:bg-surface-secondary disabled:opacity-60"
          >
            <Undo2 className="w-4 h-4" />
          </button>
        )}
        {!closed && canWrite && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => act('close')}
            className="h-8 px-2.5 rounded-lg border border-border-default text-xs font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-60"
          >
            Close chat
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close conversation" className="h-8 w-8 rounded-lg flex items-center justify-center text-foreground-muted hover:bg-surface-secondary lg:hidden">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )

  const banner = (
    <>
      {s.handler === 'human' && !closed && (s.handoffSummary || s.handoffReason) && (
        <div className="px-4 py-2 border-b border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/15 text-xs text-amber-900 dark:text-amber-200">
          <p className="font-semibold flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" />
            Handed over by the assistant{s.handoffReason ? `: ${s.handoffReason}` : ''}
          </p>
          {s.handoffSummary && <p className="mt-0.5 whitespace-pre-wrap">{s.handoffSummary}</p>}
        </div>
      )}
      {waClosed && !closed && (
        <div className="px-4 py-1.5 border-b border-border-default bg-surface-secondary text-[11px] text-foreground-muted">
          The customer last wrote over 24 hours ago, so WhatsApp only allows a template message. Your reply goes out as the support template with a link to the chat.
        </div>
      )}
    </>
  )

  return (
    <ChatShell
      header={header}
      banner={banner}
      composer={
        <Composer
          ref={composer}
          text={text}
          setText={setText}
          onSend={(t, a) => chat.send(t, a)}
          upload={upload}
          onPickFromDrive={onPickFromDrive}
          onTyping={chat.notifyTyping}
          notice={closed ? 'This chat is closed.' : !canWrite ? 'You can read this chat but not reply.' : undefined}
          placeholder={s.handler === 'ai' ? 'Reply to take over from the assistant…' : 'Type a reply'}
          accessory={<QuickReplies onPick={t => setText(t.replaceAll('{store}', storeName))} />}
          inField={
            <AIEnrichButton
              placement="in-field"
              anchorClassName="absolute right-2 bottom-1.5"
              fieldLabel="Support chat reply"
              value={text}
              onChange={setText}
              scope="customers:write"
              write={!!lastCustomer}
              context={`Live support chat reply from ${storeName} to a customer; short and friendly.${lastCustomer ? ` The customer wrote: "${lastCustomer.slice(0, 600)}"` : ''}`}
            />
          }
        />
      }
    >
      <MessageList
        messages={chat.messages}
        isMine={isMine}
        labelFor={labelFor}
        showTicks={showTicks}
        onRetry={chat.retry}
        orderHref={orderHref}
        empty={chat.loading ? <p className="text-center text-xs text-foreground-muted pt-8">Loading…</p> : <p className="text-center text-xs text-foreground-muted pt-8">No messages yet</p>}
        footer={typingLabel ? <TypingIndicator label={typingLabel} /> : null}
      />
    </ChatShell>
  )
}
