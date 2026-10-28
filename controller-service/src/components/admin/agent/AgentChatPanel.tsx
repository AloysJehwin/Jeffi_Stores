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
} from 'lucide-react'
import AdminAgentMessage from '../AdminAgentMessage'
import AdminAgentBlocks from '../AdminAgentBlocks'
import type { AdminAgentChat, ChatTurn, TimelineItem, ToolStep } from '@/hooks/useAdminAgentChat'

// Chat transcript + composer (+ optional history sidebar) shared by AdminAgentModal and
// the /admin/agent page; each keeps its own chrome and tabs.

interface Props {
  chat: AdminAgentChat
  variant: 'modal' | 'page'
  showHistory: boolean
  onConversationPicked?: () => void
  /** Wraps the Approve/Reject buttons (the page gates them on agent:write). */
  approveWrapper?: (node: ReactNode) => ReactNode
  empty: ReactNode
}

export default function AgentChatPanel({ chat, variant, showHistory, onConversationPicked, approveWrapper, empty }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { turns, loading } = chat

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
          className={`${page ? 'flex w-full md:w-56 lg:w-64 md:border-r' : 'flex w-40 sm:w-64 border-r'} border-border-default bg-surface-secondary/50 flex-col shrink-0`}
        >
          <div className="px-3 py-2 border-b border-border-default flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Chat history</p>
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
              <button
                key={c.id}
                onClick={async () => {
                  if (await chat.loadConversation(c.id)) onConversationPicked?.()
                }}
                className={`w-full text-left px-2 ${page ? 'py-2.5 md:py-1.5 text-sm md:text-xs' : 'py-1.5 text-xs'} rounded transition-colors ${
                  c.id === chat.conversationId ? 'bg-accent-500/10 border border-accent-500/30' : 'hover:bg-surface-secondary'
                }`}
              >
                <p className="font-medium text-foreground truncate">
                  {c.title || c.preview?.slice(0, 60) || 'Untitled chat'}
                </p>
                <p className="text-[10px] text-foreground-muted">
                  {new Date(c.last_message_at).toLocaleString()} · {c.message_count} msg
                </p>
              </button>
            ))}
          </div>
        </aside>
      )}

      <div className={`${page && showHistory ? 'hidden md:flex' : 'flex'} flex-1 flex-col min-w-0`}>
        <div
          ref={scrollRef}
          className={`overflow-y-auto p-4 space-y-3 flex-1 min-h-0 ${page ? 'pb-[max(1rem,env(safe-area-inset-bottom))]' : ''}`}
        >
          {turns.length === 0 && !loading && empty}
          {turns.map(turn => (
            <TurnView key={turn.id} turn={turn} chat={chat} approveWrapper={approveWrapper} />
          ))}
        </div>
        <Composer chat={chat} inputRef={inputRef} page={page} />
      </div>
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
          <p className="whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">{turn.content}</p>
        </div>
      </div>
    )
  }

  // While streaming, hide a <ui_blocks> payload the model is still writing.
  const text = turn.streaming ? turn.content.replace(/<ui_blocks>[\s\S]*?(<\/ui_blocks>|$)/g, '') : turn.content
  const waiting = turn.streaming && !text && !turn.timeline?.length
  const wrap = approveWrapper ?? ((n: ReactNode) => n)

  return (
    <div className="group">
      <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-surface-secondary text-foreground">
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
        {turn.uiBlocks && turn.uiBlocks.length > 0 && (
          <div className={text ? 'mt-3' : 'mt-1'}>
            <AdminAgentBlocks
              blocks={turn.uiBlocks}
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
          <div className="mt-3 space-y-2">
            {turn.proposedActions.map(action => (
              <div key={action.id} className="rounded-lg border-2 border-amber-500/40 bg-amber-500/5 p-3">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-2">
                  Pending approval — {action.kind}
                </p>
                <p className="text-xs text-foreground mb-3">{action.confirmation}</p>
                {action.status === 'proposed' &&
                  wrap(
                    <div className="flex gap-2">
                      <button
                        onClick={() => chat.decideAction(turn.id, action.id, 'approve')}
                        className="flex-1 px-3 h-control-sm bg-accent-500 hover:bg-accent-600 text-white rounded text-xs font-semibold flex items-center justify-center gap-1"
                      >
                        <CheckCircle className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button
                        onClick={() => chat.decideAction(turn.id, action.id, 'reject')}
                        className="flex-1 px-3 h-control-sm bg-surface hover:bg-surface-secondary text-foreground rounded text-xs font-semibold flex items-center justify-center gap-1 border border-border-default"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Reject
                      </button>
                    </div>
                  )}
                {action.status === 'approving' && (
                  <p className="text-xs text-foreground-muted flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" /> Executing
                  </p>
                )}
                {action.status === 'approved' && (
                  <p className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1.5">
                    <CheckCircle className="w-3 h-3" /> Executed
                  </p>
                )}
                {action.status === 'rejected' && (
                  <p className="text-xs text-foreground-muted flex items-center gap-1.5">
                    <XCircle className="w-3 h-3" /> Rejected
                  </p>
                )}
                {action.status === 'failed' && (
                  <p className="text-xs text-red-500 [overflow-wrap:anywhere]">Failed: {action.error || 'unknown'}</p>
                )}
              </div>
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
