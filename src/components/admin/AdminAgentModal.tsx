'use client'

import { useEffect, useRef, useState } from 'react'
import { Bot, X, Send, MessageSquare, Slash, LayoutGrid, CheckCircle, XCircle, Loader2, Maximize2, Minimize2, Plus, History, Paperclip } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import AdminAgentMessage from './AdminAgentMessage'
import AdminAgentBlocks, { type UiBlock } from './AdminAgentBlocks'

interface Props {
  isOpen: boolean
  onClose: () => void
}

type Tab = 'chat' | 'slash' | 'tools'

interface ProposedAction {
  id: string
  kind: string
  payload: Record<string, unknown>
  confirmation: string
  status: 'proposed' | 'approving' | 'approved' | 'rejected' | 'failed'
  result?: unknown
  error?: string
}

interface ToolCall {
  tool: string
  input: Record<string, unknown>
  output: unknown
  isError?: boolean
}

interface PickerOption {
  id: string
  label: string
  sublabel?: string
}

interface Picker {
  choice_kind: string
  options: PickerOption[]
  note?: string
}

interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCall[]
  proposedActions?: ProposedAction[]
  pickers?: Picker[]
  pickerResolved?: boolean
  uiBlocks?: UiBlock[]
}

const SLASH_COMMANDS: { command: string; example: string; description: string }[] = [
  { command: '/find-customer', example: '/find-customer aloys@gmail.com', description: 'Get full customer profile + LTV' },
  { command: '/products-top', example: '/products-top', description: 'Top selling products in the last 30 days' },
  { command: '/restock-suggestions', example: '/restock-suggestions', description: 'Low-stock items that need ordering' },
  { command: '/stuck-shipments', example: '/stuck-shipments', description: 'Orders shipped >3 days ago, not delivered' },
  { command: '/campaign-stats', example: '/campaign-stats', description: 'Campaign performance for the last 30 days' },
]

const TOOL_PALETTE: { label: string; description: string; prompt: string }[] = [
  { label: 'Top customers by spend', description: 'Highest lifetime value', prompt: 'Show me my top 5 customers by lifetime value' },
  { label: 'Stuck shipments', description: 'Orders not delivered after 3 days', prompt: 'List orders that have been shipped but not delivered for more than 3 days' },
  { label: 'Restock plan', description: 'Low stock items + their recent demand', prompt: 'Show me products with stock <= 5, ordered by how much we have sold them in the last 30 days' },
  { label: 'Yesterday orders', description: 'Quick recap', prompt: 'Summarise yesterday orders by status and total revenue' },
  { label: 'Abandoned cart performance', description: 'How is the campaign doing?', prompt: 'Get the abandoned_cart campaign stats for the last 30 days' },
  { label: 'New customers this week', description: 'Last 7 days', prompt: 'Show me customers who signed up in the last 7 days, ordered by recency' },
]

interface ConversationListItem {
  id: string
  title: string | null
  preview: string | null
  last_message_at: string
  message_count: number
}

export default function AdminAgentModal({ isOpen, onClose }: Props) {
  const { showToast } = useToast()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<Tab>('chat')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [maximized, setMaximized] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [attachmentId, setAttachmentId] = useState<string | null>(null)

  function clearAttachment() {
    setPendingFile(null)
    setAttachmentId(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 5 * 1024 * 1024) {
      showToast('File too large (max 5MB)', 'error')
      e.target.value = ''
      return
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowed.includes(f.type)) {
      showToast('Only JPG, PNG, WEBP, or PDF files are supported', 'error')
      e.target.value = ''
      return
    }
    setPendingFile(f)
    setAttachmentId(null)
  }

  async function uploadPendingFile(): Promise<string | null> {
    if (!pendingFile) return null
    if (attachmentId) return attachmentId
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', pendingFile)
      const res = await fetch('/api/admin/agent/upload', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(data.error || 'Upload failed', 'error')
        return null
      }
      setAttachmentId(data.attachment_id)
      return data.attachment_id as string
    } catch (e: any) {
      showToast(e?.message || 'Upload failed', 'error')
      return null
    } finally {
      setUploading(false)
    }
  }

  async function loadConversations() {
    setLoadingHistory(true)
    try {
      const res = await fetch('/api/admin/agent/conversations?limit=30', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setConversations(data.items || [])
      }
    } finally { setLoadingHistory(false) }
  }

  async function loadConversation(id: string) {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/agent/conversations/${id}/messages`, { credentials: 'include' })
      if (!res.ok) { showToast('Failed to load conversation', 'error'); return }
      const data = await res.json()
      const restored: ChatTurn[] = (data.messages || []).map((m: any) => ({
        id: m.id || crypto.randomUUID(),
        role: m.role,
        content: m.content,
        toolCalls: m.tool_calls || undefined,
      }))
      setTurns(restored)
      setConversationId(id)
      setShowHistory(false)
    } finally { setLoading(false) }
  }

  function newChat() {
    setTurns([])
    setConversationId(null)
    setInput('')
    setShowHistory(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  useEffect(() => {
    if (!isOpen) return
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    loadConversations()
    return () => clearTimeout(t)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      setInput('')
      setTurns([])
      setConversationId(null)
      setLoading(false)
      setShowHistory(false)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [isOpen, onClose])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns, loading])

  async function sendMessage(text: string) {
    const trimmed = text.trim()
    const hasFile = !!pendingFile
    if ((!trimmed && !hasFile) || loading) return

    let attId = attachmentId
    if (hasFile && !attId) {
      attId = await uploadPendingFile()
      if (!attId) return
    }

    const fileNote = pendingFile ? ` [attachment_id=${attId} filename="${pendingFile.name}" mime=${pendingFile.type}]` : ''
    const finalUserText = (trimmed || (hasFile ? `Process the attached ${pendingFile?.type.startsWith('image/') ? 'image' : 'PDF'} as a quotation request.` : '')) + fileNote

    const displayContent = trimmed || `📎 ${pendingFile?.name || 'attachment'}`
    const userTurn: ChatTurn = { id: crypto.randomUUID(), role: 'user', content: displayContent }
    setTurns(t => [...t, userTurn])
    setInput('')
    clearAttachment()
    setLoading(true)
    try {
      const res = await fetch('/api/admin/agent/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message: finalUserText }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Agent error', 'error')
        setTurns(t => [...t, { id: crypto.randomUUID(), role: 'assistant', content: `Error: ${data.error || 'unknown'}` }])
        return
      }
      if (data.conversationId) setConversationId(data.conversationId)
      setTurns(t => [...t, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.message,
        toolCalls: data.toolCalls,
        proposedActions: (data.proposedActions || []).map((a: any) => ({ ...a, status: 'proposed' as const })),
        pickers: data.pickers || [],
        uiBlocks: data.uiBlocks || [],
      }])
    } catch (err: any) {
      showToast(err?.message || 'Network error', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function pickOption(turnId: string, picker: Picker, option: PickerOption) {
    setTurns(prev => prev.map(t => t.id !== turnId ? t : { ...t, pickerResolved: true }))
    const followUp = `Use ${picker.choice_kind} id ${option.id} (${option.label}) for the previous request.`
    sendMessage(followUp)
  }

  async function decideAction(turnId: string, actionId: string, decision: 'approve' | 'reject') {
    setTurns(prev => prev.map(t => t.id !== turnId ? t : {
      ...t,
      proposedActions: t.proposedActions?.map(a => a.id !== actionId ? a : { ...a, status: 'approving' }),
    }))
    try {
      const res = await fetch(`/api/admin/agent/actions/${actionId}/${decision}`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      const newStatus: ProposedAction['status'] = !res.ok ? 'failed'
        : decision === 'reject' ? 'rejected'
        : 'approved'
      setTurns(prev => prev.map(t => t.id !== turnId ? t : {
        ...t,
        proposedActions: t.proposedActions?.map(a => a.id !== actionId ? a : { ...a, status: newStatus, result: data.result, error: data.error }),
      }))
      if (!res.ok) showToast(data.error || 'Action failed', 'error')
      else showToast(decision === 'approve' ? 'Action executed' : 'Action rejected', 'success')
    } catch (err: any) {
      setTurns(prev => prev.map(t => t.id !== turnId ? t : {
        ...t,
        proposedActions: t.proposedActions?.map(a => a.id !== actionId ? a : { ...a, status: 'failed', error: err?.message }),
      }))
      showToast(err?.message || 'Network error', 'error')
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  if (!isOpen) return null

  return (
    <>
      <div
        className="fixed inset-0 z-30"
        style={{ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', backgroundColor: 'rgba(15, 23, 42, 0.45)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`fixed left-1/2 -translate-x-1/2 z-50 transition-all ${
          maximized
            ? 'top-3 w-[calc(100vw-1.5rem)] h-[calc(100vh-1.5rem)]'
            : 'top-3 sm:top-5 w-[min(1100px,calc(100vw-1.5rem))] max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-2.5rem)]'
        }`}
      >
        <div className={`bg-surface-elevated rounded-2xl border border-border-default shadow-2xl overflow-hidden flex flex-col h-full ${maximized ? '' : 'max-h-[inherit]'}`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-default shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-500 to-secondary-500 flex items-center justify-center">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Admin Assistant</h2>
                <p className="text-[10px] text-foreground-muted">Read-only chat + admin-approved actions</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={newChat}
                className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors"
                title="New chat"
                aria-label="New chat"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowHistory(s => !s)}
                className={`p-1.5 rounded-lg transition-colors ${showHistory ? 'bg-surface-secondary text-foreground' : 'text-foreground-muted hover:text-foreground hover:bg-surface-secondary'}`}
                title="Chat history"
                aria-label="Chat history"
              >
                <History className="w-4 h-4" />
              </button>
              <button
                onClick={() => setMaximized(m => !m)}
                className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors"
                title={maximized ? 'Restore' : 'Maximize'}
                aria-label={maximized ? 'Restore' : 'Maximize'}
              >
                {maximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
              <button onClick={onClose} className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1 px-2 border-b border-border-default">
            {([
              { id: 'chat', label: 'Chat', icon: MessageSquare },
              { id: 'slash', label: 'Slash', icon: Slash },
              { id: 'tools', label: 'Tools', icon: LayoutGrid },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors border-b-2 ${
                  tab === id
                    ? 'text-accent-600 dark:text-accent-400 border-accent-500'
                    : 'text-foreground-muted hover:text-foreground border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {tab === 'chat' && (
            <div className="flex flex-1 min-h-0">
              {showHistory && (
                <aside className="w-64 border-r border-border-default bg-surface-secondary/50 flex flex-col shrink-0">
                  <div className="px-3 py-2 border-b border-border-default flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Chat history</p>
                    <button
                      onClick={loadConversations}
                      disabled={loadingHistory}
                      className="text-[10px] text-foreground-muted hover:text-foreground"
                    >
                      {loadingHistory ? '...' : 'refresh'}
                    </button>
                  </div>
                  <div className="overflow-y-auto flex-1 p-2 space-y-1">
                    {conversations.length === 0 && !loadingHistory && (
                      <p className="text-[11px] text-foreground-muted p-2">No past conversations.</p>
                    )}
                    {conversations.map(c => (
                      <button
                        key={c.id}
                        onClick={() => loadConversation(c.id)}
                        className={`w-full text-left px-2 py-1.5 rounded transition-colors text-xs ${
                          c.id === conversationId ? 'bg-accent-500/10 border border-accent-500/30' : 'hover:bg-surface-secondary'
                        }`}
                      >
                        <p className="font-medium text-foreground truncate">{c.title || c.preview?.slice(0, 60) || 'Untitled chat'}</p>
                        <p className="text-[10px] text-foreground-muted">
                          {new Date(c.last_message_at).toLocaleString()} · {c.message_count} msg
                        </p>
                      </button>
                    ))}
                  </div>
                </aside>
              )}
              <div className="flex-1 flex flex-col min-w-0">
              <div ref={scrollRef} className="overflow-y-auto p-4 space-y-3 flex-1 min-h-0">
                {turns.length === 0 && !loading && (
                  <div className="text-center py-8">
                    <p className="text-sm text-foreground-muted">Ask me anything about the store. I can search products, look up orders, summarise customers, propose actions for your approval.</p>
                  </div>
                )}
                {turns.map(turn => (
                  <div key={turn.id} className={turn.role === 'user' ? 'flex justify-end' : ''}>
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      turn.role === 'user'
                        ? 'bg-accent-500 text-white'
                        : 'bg-surface-secondary text-foreground'
                    }`}>
                      {turn.role === 'user'
                        ? <p className="whitespace-pre-wrap leading-relaxed">{turn.content}</p>
                        : (
                          <>
                            {turn.content && <AdminAgentMessage text={turn.content} />}
                            {turn.uiBlocks && turn.uiBlocks.length > 0 && (
                              <div className={turn.content ? 'mt-3' : ''}>
                                <AdminAgentBlocks
                                  blocks={turn.uiBlocks}
                                  pickerResolved={turn.pickerResolved}
                                  onPickOption={(kind, option) => {
                                    setTurns(prev => prev.map(t => t.id !== turn.id ? t : { ...t, pickerResolved: true }))
                                    sendMessage(`Use ${kind} id ${option.id} (${option.label}) for the previous request.`)
                                  }}
                                />
                              </div>
                            )}
                          </>
                        )}
                      {turn.toolCalls && turn.toolCalls.length > 0 && (
                        <details className="mt-2 text-[10px] opacity-70">
                          <summary className="cursor-pointer">{turn.toolCalls.length} tool call{turn.toolCalls.length === 1 ? '' : 's'}</summary>
                          <ul className="mt-1 space-y-0.5">
                            {turn.toolCalls.map((tc, i) => (
                              <li key={i} className="font-mono">
                                {tc.isError ? '[err] ' : '[ok] '}{tc.tool}({Object.keys(tc.input).join(',')})
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {turn.pickers && turn.pickers.length > 0 && !turn.pickerResolved && (
                        <div className="mt-3 space-y-2">
                          {turn.pickers.map((picker, pi) => (
                            <div key={pi} className="rounded-lg border border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/10 p-3">
                              <p className="text-xs font-semibold text-accent-900 dark:text-accent-200 mb-2">Pick a {picker.choice_kind}{picker.note ? ` — ${picker.note}` : ''}</p>
                              <div className="space-y-1">
                                {picker.options.map(opt => (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => pickOption(turn.id, picker, opt)}
                                    className="w-full text-left px-3 py-1.5 rounded-md hover:bg-accent-100 dark:hover:bg-accent-900/30 transition-colors"
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
                            <div key={action.id} className="rounded-lg border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3">
                              <p className="text-xs font-semibold text-amber-900 dark:text-amber-200 mb-2">Pending approval — {action.kind}</p>
                              <p className="text-xs text-foreground mb-3">{action.confirmation}</p>
                              {action.status === 'proposed' && (
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => decideAction(turn.id, action.id, 'approve')}
                                    className="flex-1 px-3 py-1.5 bg-accent-500 hover:bg-accent-600 text-white rounded text-xs font-semibold flex items-center justify-center gap-1"
                                  >
                                    <CheckCircle className="w-3.5 h-3.5" /> Approve
                                  </button>
                                  <button
                                    onClick={() => decideAction(turn.id, action.id, 'reject')}
                                    className="flex-1 px-3 py-1.5 bg-surface hover:bg-surface-secondary text-foreground rounded text-xs font-semibold flex items-center justify-center gap-1 border border-border-default"
                                  >
                                    <XCircle className="w-3.5 h-3.5" /> Reject
                                  </button>
                                </div>
                              )}
                              {action.status === 'approving' && (
                                <p className="text-xs text-foreground-muted flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Executing</p>
                              )}
                              {action.status === 'approved' && (
                                <p className="text-xs text-green-700 dark:text-green-300 flex items-center gap-1.5"><CheckCircle className="w-3 h-3" /> Executed</p>
                              )}
                              {action.status === 'rejected' && (
                                <p className="text-xs text-foreground-muted flex items-center gap-1.5"><XCircle className="w-3 h-3" /> Rejected</p>
                              )}
                              {action.status === 'failed' && (
                                <p className="text-xs text-red-700 dark:text-red-300">Failed: {action.error || 'unknown'}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex items-center gap-2 text-sm text-foreground-muted">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Thinking, calling tools</span>
                  </div>
                )}
              </div>

              <div className="border-t border-border-default p-2 flex flex-col gap-2">
                {pendingFile && (
                  <div className="flex items-center gap-2 px-2 py-1.5 bg-surface-secondary rounded-lg text-xs">
                    <Paperclip className="w-3.5 h-3.5 text-foreground-muted shrink-0" />
                    <span className="truncate flex-1 text-foreground">{pendingFile.name}</span>
                    <span className="text-[10px] text-foreground-muted shrink-0">{(pendingFile.size / 1024).toFixed(0)} KB</span>
                    {uploading && <Loader2 className="w-3 h-3 animate-spin text-foreground-muted" />}
                    {attachmentId && <CheckCircle className="w-3 h-3 text-green-600" />}
                    <button
                      type="button"
                      onClick={clearAttachment}
                      className="p-0.5 text-foreground-muted hover:text-foreground"
                      aria-label="Remove attachment"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={onPickFile}
                    className="hidden"
                  />
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    rows={1}
                    maxLength={2000}
                    disabled={loading}
                    placeholder={pendingFile ? 'Add an instruction (optional) and send' : 'Ask anything about the store'}
                    className="flex-1 px-3 py-2 text-sm bg-surface text-foreground placeholder:text-foreground-muted rounded-lg border border-border-secondary focus:outline-none focus:ring-2 focus:ring-accent-500 resize-none"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading || uploading}
                    className="w-9 h-9 flex items-center justify-center text-foreground-muted hover:text-foreground hover:bg-surface-secondary rounded-lg disabled:opacity-50 shrink-0"
                    aria-label="Attach file"
                    title="Attach image or PDF (max 5MB)"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => sendMessage(input)}
                    disabled={loading || uploading || (!pendingFile && input.trim().length < 2)}
                    className="w-9 h-9 flex items-center justify-center bg-accent-500 hover:bg-accent-600 text-white rounded-lg disabled:opacity-50 shrink-0"
                    aria-label="Send"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
              </div>
            </div>
          )}

          {tab === 'slash' && (
            <div className="p-4 space-y-2 overflow-y-auto flex-1 min-h-0">
              <p className="text-xs text-foreground-muted mb-2">Quick commands. Click to send.</p>
              {SLASH_COMMANDS.map(cmd => (
                <button
                  key={cmd.command}
                  onClick={() => { setTab('chat'); sendMessage(cmd.example) }}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-border-default hover:border-accent-500 hover:bg-surface-secondary transition-colors"
                >
                  <p className="text-sm font-mono text-accent-600 dark:text-accent-400">{cmd.example}</p>
                  <p className="text-xs text-foreground-muted mt-0.5">{cmd.description}</p>
                </button>
              ))}
            </div>
          )}

          {tab === 'tools' && (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2 overflow-y-auto flex-1 min-h-0">
              {TOOL_PALETTE.map(t => (
                <button
                  key={t.label}
                  onClick={() => { setTab('chat'); sendMessage(t.prompt) }}
                  className="text-left px-3 py-3 rounded-lg border border-border-default hover:border-accent-500 hover:bg-surface-secondary transition-colors"
                >
                  <p className="text-sm font-semibold text-foreground">{t.label}</p>
                  <p className="text-xs text-foreground-muted mt-0.5">{t.description}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
