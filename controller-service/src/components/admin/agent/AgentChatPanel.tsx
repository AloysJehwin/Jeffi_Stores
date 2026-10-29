'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CheckCircle,
  XCircle,
  Loader2,
  Paperclip,
  X,
  Send,
  Square,
  Copy,
  Check,
  RotateCcw,
  ChevronRight,
  Wrench,
  AlertTriangle,
  Users,
  Link2,
  Pencil,
  Trash2,
  Lock,
} from 'lucide-react'
import AdminAgentMessage, { AdminAgentUserMessage, internalMessageLabel } from '../AdminAgentMessage'
import AdminAgentBlocks from '../AdminAgentBlocks'
import ProposedActionCard, { splitProposalBlocks } from './ProposedActionCard'
import { useConfirm, usePrompt } from '@/contexts/ConfirmContext'
import { useToast } from '@/contexts/ToastContext'
import { ap } from '@/lib/shared/admin-path'
import { useAdminHost } from '@/contexts/AdminHostContext'
import type { AdminAgentChat, ChatTurn, ConversationListItem, TimelineItem, ToolStep } from '@/hooks/useAdminAgentChat'

// Chat transcript + composer (+ optional history list) shared by the bottom-right dock and the
// /admin/agent page; each keeps its own chrome.

interface Props {
  chat: AdminAgentChat
  variant: 'dock' | 'page'
  showHistory: boolean
  onConversationPicked?: () => void
  /** Wraps the Approve/Reject buttons (the page gates them on agent:write). */
  approveWrapper?: (node: ReactNode) => ReactNode
  empty: ReactNode
}

/** A chat's display name: its title without attachment markers, or a control message's label. */
export function chatTitle(title: string | null | undefined): string {
  return internalMessageLabel(title) || title?.replace(/\s*\[attachment_id=[^\]]*\]/g, '').trim() || 'Untitled chat'
}

export default function AgentChatPanel({ chat, variant, showHistory, onConversationPicked, approveWrapper, empty }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { turns, loading } = chat
  const readOnly = chat.info.readOnly

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns, loading])

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [])

  const page = variant === 'page'

  return (
    <div className="flex flex-1 min-h-0">
      {showHistory && (
        <aside
          className={`${page ? 'flex w-full md:w-56 lg:w-64 md:border-r' : 'flex w-full'} border-border-default bg-surface-secondary/50 flex-col shrink-0`}
        >
          <div className="px-3 py-2 border-b border-border-default flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Your chats</p>
            <button
              onClick={chat.loadConversations}
              disabled={chat.loadingHistory}
              className="text-[10px] text-foreground-muted hover:text-foreground"
            >
              {chat.loadingHistory ? '...' : 'refresh'}
            </button>
          </div>
          <div className="overflow-y-auto flex-1 p-2 space-y-1">
            {chat.conversations.length === 0 && !chat.loadingHistory && (
              <p className="text-[11px] text-foreground-muted p-2">No past conversations.</p>
            )}
            {chat.conversations.map(c => (
              <HistoryItem key={c.id} item={c} chat={chat} page={page} onPicked={onConversationPicked} />
            ))}
          </div>
          <p className="px-3 py-2 border-t border-border-default text-[10px] text-foreground-muted">
            Only you can see your chats unless you share one.
          </p>
        </aside>
      )}

      <div className={`${showHistory ? (page ? 'hidden md:flex' : 'hidden') : 'flex'} flex-1 flex-col min-w-0`}>
        <div
          ref={scrollRef}
          className={`overflow-y-auto p-4 space-y-3 flex-1 min-h-0 ${page ? 'pb-[max(1rem,env(safe-area-inset-bottom))]' : ''}`}
        >
          {turns.length === 0 && !loading && empty}
          {turns.map(turn => (
            <TurnView
              key={turn.id}
              turn={turn}
              chat={chat}
              approveWrapper={readOnly ? () => null : approveWrapper}
            />
          ))}
        </div>
        {readOnly ? <ReadOnlyBar chat={chat} page={page} /> : <Composer chat={chat} inputRef={inputRef} page={page} />}
      </div>
    </div>
  )
}

function HistoryItem({
  item: c,
  chat,
  page,
  onPicked,
}: {
  item: ConversationListItem
  chat: AdminAgentChat
  page: boolean
  onPicked?: () => void
}) {
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { showToast } = useToast()
  const host = useAdminHost()
  const title = chatTitle(c.title || c.preview)

  async function share() {
    if (c.shared) {
      if (await chat.patchConversation(c.id, { shared: false })) showToast('Chat is private again', 'success')
      return
    }
    if (!(await chat.patchConversation(c.id, { shared: true }))) return
    const url = `${window.location.origin}${ap(`/admin/agent?c=${c.id}`, host)}`
    try {
      await navigator.clipboard.writeText(url)
      showToast('Shared read-only with other admins · link copied', 'success')
    } catch {
      showToast('Shared read-only with other admins', 'success')
    }
  }

  async function rename() {
    const next = await prompt({ title: 'Rename chat', message: 'A name for this chat', defaultValue: title, confirmLabel: 'Save' })
    if (next?.trim()) await chat.patchConversation(c.id, { title: next.trim() })
  }

  async function remove() {
    const ok = await confirm({
      title: 'Delete chat',
      message: `Delete "${title}"? Its messages are removed for good${c.shared ? ' and the shared link stops working' : ''}.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (ok) await chat.deleteConversation(c.id)
  }

  const action = 'p-1 rounded text-foreground-muted hover:text-foreground hover:bg-surface'
  return (
    <div
      className={`group/item relative rounded transition-colors ${
        c.id === chat.conversationId ? 'bg-accent-500/10 border border-accent-500/30' : 'hover:bg-surface-secondary'
      }`}
    >
      <button
        onClick={async () => {
          if (await chat.loadConversation(c.id)) onPicked?.()
        }}
        className={`w-full text-left px-2 [@media(hover:none)]:pr-20 ${page ? 'py-2.5 md:py-1.5 text-sm md:text-xs' : 'py-1.5 text-xs'}`}
      >
        <p className="font-medium text-foreground truncate">{title}</p>
        <p className="flex items-center gap-1 text-[10px] text-foreground-muted">
          {c.shared && <Users className="w-3 h-3 text-accent-500" aria-label="Shared" />}
          {new Date(c.last_message_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {c.message_count} msg
        </p>
      </button>
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center rounded bg-surface-elevated/95 shadow-sm opacity-0 pointer-events-none group-hover/item:opacity-100 group-hover/item:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:bg-transparent [@media(hover:none)]:shadow-none transition-opacity">
        <button onClick={share} className={action} title={c.shared ? 'Stop sharing' : 'Share read-only with other admins'}>
          <Link2 className={`w-3.5 h-3.5 ${c.shared ? 'text-accent-500' : ''}`} />
        </button>
        <button onClick={rename} className={action} title="Rename">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={remove} className={action} title="Delete">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

/** In place of the composer on another admin's shared chat. */
function ReadOnlyBar({ chat, page }: { chat: AdminAgentChat; page: boolean }) {
  const { ownerName, title } = chat.info
  return (
    <div
      className={`border-t border-border-default ${page ? 'p-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]' : 'p-2'} flex flex-wrap items-center gap-2 text-xs shrink-0`}
    >
      <Lock className="w-3.5 h-3.5 text-foreground-muted shrink-0" />
      <span className="flex-1 min-w-0 text-foreground-muted">
        Shared by {ownerName || 'another admin'} · read-only
      </span>
      <button
        onClick={() => {
          chat.reset()
          chat.setInput(`Following up on "${chatTitle(title)}": `)
        }}
        className="px-2.5 py-1.5 rounded-lg bg-accent-500 hover:bg-accent-600 text-white font-semibold"
      >
        Continue in a new chat
      </button>
    </div>
  )
}

function TurnView({
  turn,
  chat,
  approveWrapper,
}: {
  turn: ChatTurn
  chat: AdminAgentChat
  approveWrapper?: (node: ReactNode) => ReactNode
}) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-accent-500 text-white">
          <AdminAgentUserMessage text={turn.content} />
        </div>
      </div>
    )
  }

  // While streaming, hide a <ui_blocks> payload the model is still writing.
  const text = turn.streaming ? turn.content.replace(/<ui_blocks>[\s\S]*?(<\/ui_blocks>|$)/g, '') : turn.content
  const waiting = turn.streaming && !text && !turn.timeline?.length
  const { rest: blocks, byAction } = splitProposalBlocks(turn.uiBlocks, turn.proposedActions)
  // Cards (documents, resolvers, proposals) get the full width on a narrow panel.
  const rich = !!(turn.uiBlocks?.length || turn.proposedActions?.length)

  return (
    <div className="group">
      <div className={`${rich ? 'max-w-full sm:max-w-[85%]' : 'max-w-[85%]'} rounded-lg px-3 py-2 text-sm bg-surface-secondary text-foreground`}>
        {turn.timeline && turn.timeline.length > 0 && (
          <ToolTimeline items={turn.timeline} live={!!turn.streaming} />
        )}
        {waiting && (
          <p className="flex items-center gap-2 text-foreground-muted">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking
          </p>
        )}
        {text && (
          <div className={turn.timeline?.length ? 'mt-2' : ''}>
            <AdminAgentMessage text={text} cursor={turn.streaming} />
          </div>
        )}
        {!text && turn.streaming && !!turn.timeline?.length && (
          <span className="inline-block w-1.5 h-4 mt-1 bg-foreground-muted animate-pulse align-middle" aria-hidden="true" />
        )}
        {blocks.length > 0 && (
          <div className={text ? 'mt-3' : 'mt-1'}>
            <AdminAgentBlocks
              blocks={blocks}
              pickerResolved={turn.pickerResolved}
              onPickOption={(kind, option) => chat.pick(turn.id, kind, option)}
              onSendMessage={msg => {
                chat.setTurns(prev => prev.map(t => (t.id !== turn.id ? t : { ...t, pickerResolved: true })))
                chat.sendMessage(msg)
              }}
            />
          </div>
        )}
        {turn.error && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 px-2 py-1.5 text-xs text-red-600 dark:text-red-400">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span className="flex-1 [overflow-wrap:anywhere]">{turn.error}</span>
            {turn.retryText && (
              <button
                onClick={() => chat.retry(turn.id)}
                disabled={chat.loading}
                className="flex items-center gap-1 font-semibold hover:underline disabled:opacity-50 shrink-0"
              >
                <RotateCcw className="w-3 h-3" /> Retry
              </button>
            )}
          </div>
        )}
        {turn.pickers && turn.pickers.length > 0 && !turn.pickerResolved && (
          <div className="mt-3 space-y-2">
            {turn.pickers.map((picker, pi) => (
              <div key={pi} className="rounded-lg border border-accent-500/40 bg-accent-500/5 p-3">
                <p className="text-xs font-semibold text-foreground mb-2">
                  Pick a {picker.choice_kind}
                  {picker.note ? ` — ${picker.note}` : ''}
                </p>
                <div className="space-y-1">
                  {picker.options.map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => chat.pick(turn.id, picker.choice_kind, opt)}
                      className="w-full text-left px-3 py-1.5 rounded-md hover:bg-accent-500/10 transition-colors"
                    >
                      <p className="text-sm font-medium text-foreground">{opt.label}</p>
                      {opt.sublabel && <p className="text-[11px] text-foreground-muted">{opt.sublabel}</p>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {turn.proposedActions && turn.proposedActions.length > 0 && (
          <div className={`${text || blocks.length ? 'mt-3' : 'mt-1'} space-y-2`}>
            {turn.proposedActions.map(action => (
              <ProposedActionCard
                key={action.id}
                action={action}
                blocks={byAction[action.id]}
                onDecide={decision => chat.decideAction(turn.id, action.id, decision)}
                approveWrapper={approveWrapper}
              />
            ))}
          </div>
        )}
      </div>
      {!turn.streaming && (turn.content || turn.model) && <TurnMeta turn={turn} />}
    </div>
  )
}

function TurnMeta({ turn }: { turn: ChatTurn }) {
  const [copied, setCopied] = useState(false)
  const u = turn.usage
  const tokens = u && (u.promptTokens || u.completionTokens) ? `${fmtK(u.promptTokens)} in · ${fmtK(u.completionTokens)} out` : ''
  const cost = u?.costInr != null && u.costInr > 0 ? `₹${u.costInr < 1 ? u.costInr.toFixed(3) : u.costInr.toFixed(2)}` : ''
  const meta = [turn.provider === 'anthropic' ? 'Claude' : turn.provider, turn.model, tokens, cost].filter(Boolean).join(' · ')
  return (
    <div className="mt-1 flex items-center gap-2 text-[10px] text-foreground-muted opacity-60 group-hover:opacity-100 transition-opacity">
      {turn.content && (
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(turn.content)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            } catch {
              /* clipboard blocked */
            }
          }}
          className="flex items-center gap-1 hover:text-foreground"
          title="Copy message"
          aria-label="Copy message"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>
      )}
      {meta && <span className="[overflow-wrap:anywhere]">{meta}</span>}
    </div>
  )
}

function fmtK(n?: number): string {
  const v = Number(n || 0)
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
}

function ToolTimeline({ items, live }: { items: TimelineItem[]; live: boolean }) {
  const [open, setOpen] = useState(live)
  useEffect(() => setOpen(live), [live])
  const steps = items.filter((i): i is { kind: 'tool'; step: ToolStep } => i.kind === 'tool')
  const ms = steps.reduce((a, s) => a + (s.step.durationMs || 0), 0)
  const errors = steps.filter(s => s.step.status === 'error').length
  return (
    <div className="text-[11px] mb-1">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-foreground-muted hover:text-foreground"
      >
        <ChevronRight className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        <Wrench className="w-3 h-3" />
        {steps.length} tool call{steps.length === 1 ? '' : 's'}
        {ms > 0 && ` · ${(ms / 1000).toFixed(1)}s`}
        {errors > 0 && <span className="text-red-500"> · {errors} failed</span>}
      </button>
      {open && (
        <ol className="mt-1 ml-1 border-l border-border-default pl-2 space-y-1">
          {items.map((item, i) =>
            item.kind === 'note' ? (
              <li key={i} className="italic text-foreground-muted whitespace-pre-wrap [overflow-wrap:anywhere]">
                {item.text}
              </li>
            ) : (
              <StepRow key={item.step.id} step={item.step} />
            )
          )}
        </ol>
      )}
    </div>
  )
}

function StepRow({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false)
  const icon =
    step.status === 'ok' ? (
      <CheckCircle className="w-3 h-3 text-green-600 shrink-0" />
    ) : step.status === 'error' ? (
      <XCircle className="w-3 h-3 text-red-500 shrink-0" />
    ) : (
      <Loader2 className="w-3 h-3 animate-spin text-foreground-muted shrink-0" />
    )
  const args = step.input ? summarize(step.input) : ''
  const result = step.output !== undefined ? pretty(step.output) : step.preview
  return (
    <li>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-1.5 text-left hover:text-foreground">
        {icon}
        <span className="font-mono font-medium text-foreground">{step.name}</span>
        {args && <span className="font-mono text-foreground-muted truncate min-w-0">{args}</span>}
        {step.durationMs != null && (
          <span className="ml-auto text-foreground-muted shrink-0">{(step.durationMs / 1000).toFixed(1)}s</span>
        )}
      </button>
      {open && (
        <div className="mt-1 mb-1.5 space-y-1">
          {step.input && (
            <pre className="text-[10px] font-mono bg-surface rounded p-1.5 overflow-x-auto max-h-48">
              {pretty(step.input)}
            </pre>
          )}
          {result && (
            <pre
              className={`text-[10px] font-mono rounded p-1.5 overflow-x-auto max-h-64 ${step.status === 'error' ? 'bg-red-500/5 text-red-600 dark:text-red-400' : 'bg-surface'}`}
            >
              {result}
            </pre>
          )}
        </div>
      )}
    </li>
  )
}

function summarize(input: Record<string, unknown>): string {
  const s = Object.entries(input)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ')
  return s.length > 80 ? `${s.slice(0, 80)}…` : s
}

function pretty(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  return s.length > 4000 ? `${s.slice(0, 4000)}\n…` : s
}

function Composer({
  chat,
  inputRef,
  page,
}: {
  chat: AdminAgentChat
  inputRef: React.RefObject<HTMLTextAreaElement>
  page: boolean
}) {
  const { pendingFile, uploading, attachmentId, loading, input } = chat
  return (
    <div
      className={`border-t border-border-default ${page ? 'p-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] shrink-0' : 'p-2'} flex flex-col gap-2`}
    >
      {pendingFile && (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-surface-secondary rounded-lg text-xs">
          <Paperclip className="w-3.5 h-3.5 text-foreground-muted shrink-0" />
          <span className="truncate flex-1 min-w-0 text-foreground">{pendingFile.name}</span>
          <span className="text-[10px] text-foreground-muted shrink-0">{(pendingFile.size / 1024).toFixed(0)} KB</span>
          {uploading && <Loader2 className="w-3 h-3 animate-spin text-foreground-muted" />}
          {attachmentId && <CheckCircle className="w-3 h-3 text-green-600" />}
          <button
            type="button"
            onClick={chat.clearAttachment}
            className="p-0.5 text-foreground-muted hover:text-foreground"
            aria-label="Remove attachment"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={chat.fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={chat.onPickFile}
          className="hidden"
        />
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => chat.setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              chat.sendMessage(input)
            }
          }}
          rows={1}
          maxLength={2000}
          disabled={loading}
          placeholder={pendingFile ? 'Add an instruction (optional) and send' : 'Ask anything about the store'}
          className="flex-1 min-w-0 px-3 py-2 text-sm bg-surface text-foreground placeholder:text-foreground-muted rounded-lg border border-border-secondary focus:outline-none focus:ring-2 focus:ring-accent-500 resize-none"
        />
        <button
          type="button"
          onClick={() => chat.fileInputRef.current?.click()}
          disabled={loading || uploading}
          className="w-9 h-9 flex items-center justify-center text-foreground-muted hover:text-foreground hover:bg-surface-secondary rounded-lg disabled:opacity-50 shrink-0"
          aria-label="Attach file"
          title="Attach image or PDF (max 5MB)"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        {loading ? (
          <button
            onClick={chat.stop}
            className="w-9 h-9 flex items-center justify-center bg-surface-secondary hover:bg-surface text-foreground rounded-lg border border-border-default shrink-0"
            aria-label="Stop"
            title="Stop"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        ) : (
          <button
            onClick={() => chat.sendMessage(input)}
            disabled={uploading || (!pendingFile && input.trim().length < 2)}
            className="w-9 h-9 flex items-center justify-center bg-accent-500 hover:bg-accent-600 text-white rounded-lg disabled:opacity-50 shrink-0"
            aria-label="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
