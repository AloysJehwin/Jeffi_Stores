'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import type { UiBlock } from '@/components/admin/AdminAgentBlocks'
import type { PageContext } from '@/lib/admin-agent/conversations'

// Admin agent chat state, one instance for the whole admin panel (AdminAgentContext). Talks to
// /api/admin/agent/chat over SSE: text deltas, tool steps, ui blocks and actions stream in,
// then a 'done' event carries the persisted turn.

export type ActionStatus = 'proposed' | 'approving' | 'approved' | 'rejected' | 'failed'

export interface ProposedAction {
  id: string
  kind: string
  payload: Record<string, unknown>
  confirmation: string
  status: ActionStatus
  /** Preview blocks carried by the action itself (document, change_summary…). */
  blocks?: UiBlock[]
  /** The decision in flight while status is 'approving'. */
  decision?: 'approve' | 'reject'
  result?: unknown
  error?: string
}

export interface ToolCall {
  id?: string
  tool: string
  input: Record<string, unknown>
  output: unknown
  isError?: boolean
  durationMs?: number
}

export interface PickerOption {
  id: string
  label: string
  sublabel?: string
}

export interface Picker {
  choice_kind: string
  options: PickerOption[]
  note?: string
}

export interface ToolStep {
  id: string
  name: string
  input?: Record<string, unknown>
  status: 'pending' | 'running' | 'ok' | 'error'
  preview?: string
  output?: unknown
  durationMs?: number
}

export type TimelineItem = { kind: 'tool'; step: ToolStep } | { kind: 'note'; text: string }

export interface TurnUsage {
  promptTokens?: number
  completionTokens?: number
  costInr?: number
  calls?: number
}

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  model?: string
  provider?: string
  usage?: TurnUsage
  toolCalls?: ToolCall[]
  timeline?: TimelineItem[]
  proposedActions?: ProposedAction[]
  pickers?: Picker[]
  pickerResolved?: boolean
  uiBlocks?: UiBlock[]
  streaming?: boolean
  error?: string
  /** The user text to re-send on retry. */
  retryText?: string
}

export interface ConversationListItem {
  id: string
  title: string | null
  preview: string | null
  shared: boolean
  last_message_at: string
  message_count: number
}

/** Whose chat is open: the caller's own, or another admin's shared one (read-only). */
export interface ConversationInfo {
  title: string | null
  shared: boolean
  readOnly: boolean
  ownerName: string | null
}

const NEW_CHAT: ConversationInfo = { title: null, shared: false, readOnly: false, ownerName: null }

const uid = () => crypto.randomUUID()

const STATUSES: ActionStatus[] = ['proposed', 'approving', 'approved', 'rejected', 'failed']

function toAction(a: any, fallback: ActionStatus): ProposedAction {
  const blocks = a.blocks ?? a.ui_blocks ?? a.uiBlocks
  const status = a.status === 'executed' ? 'approved' : STATUSES.includes(a.status) ? a.status : fallback
  return { ...a, blocks: Array.isArray(blocks) && blocks.length ? blocks : undefined, status }
}

function timelineFrom(calls: ToolCall[] | undefined): TimelineItem[] {
  return (calls || []).map((c, i) => ({
    kind: 'tool' as const,
    step: {
      id: c.id || `t${i}`,
      name: c.tool,
      input: c.input,
      status: c.isError ? ('error' as const) : ('ok' as const),
      output: c.output,
      durationMs: c.durationMs,
    },
  }))
}

/** Parse an SSE body into (event, data) pairs. */
async function* readSse(res: Response): AsyncGenerator<{ event: string; data: any }> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (value) buf += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      let event = 'message'
      const data: string[] = []
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
      }
      if (!data.length) continue
      try {
        yield { event, data: JSON.parse(data.join('\n')) }
      } catch {
        /* skip malformed frame */
      }
    }
    if (done) break
  }
}

export function useAdminAgentChat() {
  const { showToast } = useToast()
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [info, setInfo] = useState<ConversationInfo>(NEW_CHAT)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [attachmentId, setAttachmentId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const convRef = useRef<string | null>(null)
  const pageRef = useRef<PageContext | null>(null)
  convRef.current = conversationId

  useEffect(() => () => abortRef.current?.abort(), [])

  const patchTurn = useCallback((id: string, fn: (t: ChatTurn) => ChatTurn) => {
    setTurns(prev => prev.map(t => (t.id === id ? fn(t) : t)))
  }, [])

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

  const loadConversations = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const res = await fetch('/api/admin/agent/conversations?limit=30', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setConversations(data.items || [])
      }
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  async function loadConversation(id: string, opts: { quiet?: boolean } = {}): Promise<boolean> {
    abortRef.current?.abort()
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/agent/conversations/${encodeURIComponent(id)}/messages`, {
        credentials: 'include',
      })
      if (!res.ok) {
        if (!opts.quiet) {
          const msg = res.status === 403 ? 'This chat is private to the admin who started it' : res.status === 404 ? 'Chat not found' : 'Failed to load conversation'
          showToast(msg, 'error')
        }
        return false
      }
      const data = await res.json()
      const restored: ChatTurn[] = (data.messages || []).map((m: any) => ({
        id: m.id || uid(),
        role: m.role,
        content: m.content,
        toolCalls: m.tool_calls?.length ? m.tool_calls : undefined,
        timeline: m.tool_calls?.length ? timelineFrom(m.tool_calls) : undefined,
        uiBlocks: m.ui_blocks?.length ? m.ui_blocks : undefined,
        proposedActions: m.proposed_actions?.length
          ? m.proposed_actions.map((a: any) => toAction(a, 'approved'))
          : undefined,
        pickers: m.pickers?.length ? m.pickers : undefined,
        pickerResolved: m.pickers?.length ? true : undefined,
      }))
      setTurns(restored)
      setConversationId(id)
      setInfo({ title: data.title ?? null, shared: !!data.shared, readOnly: !!data.readOnly, ownerName: data.ownerName ?? null })
      return true
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    abortRef.current?.abort()
    setTurns([])
    setConversationId(null)
    setInfo(NEW_CHAT)
    setInput('')
    setLoading(false)
  }

  async function patchConversation(id: string, patch: { title?: string; shared?: boolean }): Promise<boolean> {
    const res = await fetch(`/api/admin/agent/conversations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => null)
    if (!res?.ok) {
      showToast('Could not update the chat', 'error')
      return false
    }
    setConversations(prev => prev.map(c => (c.id !== id ? c : { ...c, ...patch, preview: patch.title ?? c.preview })))
    if (id === convRef.current) setInfo(i => ({ ...i, ...patch }))
    return true
  }

  async function deleteConversation(id: string): Promise<boolean> {
    const res = await fetch(`/api/admin/agent/conversations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => null)
    if (!res?.ok) {
      showToast('Could not delete the chat', 'error')
      return false
    }
    setConversations(prev => prev.filter(c => c.id !== id))
    if (id === convRef.current) reset()
    return true
  }

  function stop() {
    abortRef.current?.abort()
  }

  async function run(userText: string, assistantId: string, retry: boolean) {
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true)
    const flushNote = (t: ChatTurn): ChatTurn => {
      const note = t.content.replace(/<ui_blocks>[\s\S]*?(<\/ui_blocks>|$)/g, '').trim()
      return note ? { ...t, content: '', timeline: [...(t.timeline || []), { kind: 'note', text: note }] } : t
    }
    const upsertStep = (t: ChatTurn, id: string, patch: Partial<ToolStep> & { name?: string }): ChatTurn => {
      const tl = [...(t.timeline || [])]
      const i = tl.findIndex(x => x.kind === 'tool' && x.step.id === id)
      if (i >= 0) tl[i] = { kind: 'tool', step: { ...(tl[i] as { step: ToolStep }).step, ...patch } }
      else tl.push({ kind: 'tool', step: { id, name: patch.name || 'tool', status: 'pending', ...patch } })
      return { ...t, timeline: tl }
    }
    const fail = (msg: string) =>
      patchTurn(assistantId, t => ({ ...t, streaming: false, error: msg, retryText: userText }))
    const isNew = !convRef.current
    try {
      const res = await fetch('/api/admin/agent/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ conversationId: convRef.current, message: userText, retry, pageContext: pageRef.current }),
        signal: ac.signal,
      })
      if (!res.ok || !(res.headers.get('content-type') || '').includes('text/event-stream') || !res.body) {
        const data = await res.json().catch(() => ({}))
        fail(data.error || `Agent error (${res.status})`)
        return
      }
      let finished = false
      for await (const { event, data } of readSse(res)) {
        switch (event) {
          case 'meta':
            if (data.conversationId) setConversationId(data.conversationId)
            break
          case 'text':
            patchTurn(assistantId, t => ({ ...t, content: t.content + data.text }))
            break
          case 'tool_pending':
            if (data.id) patchTurn(assistantId, t => upsertStep(flushNote(t), data.id, { name: data.name, status: 'pending' }))
            break
          case 'tool_start':
            patchTurn(assistantId, t =>
              upsertStep(flushNote(t), data.id, { name: data.name, input: data.input, status: 'running' })
            )
            break
          case 'tool_end':
            patchTurn(assistantId, t =>
              upsertStep(t, data.id, {
                name: data.name,
                status: data.ok ? 'ok' : 'error',
                preview: data.preview,
                durationMs: data.durationMs,
              })
            )
            break
          case 'ui_blocks':
            patchTurn(assistantId, t => ({ ...t, uiBlocks: [...(t.uiBlocks || []), ...(data.blocks || [])] }))
            break
          case 'proposed_action':
            patchTurn(assistantId, t => ({
              ...t,
              proposedActions: [...(t.proposedActions || []), toAction({ ...data, status: 'proposed' }, 'proposed')],
            }))
            break
          case 'picker':
            patchTurn(assistantId, t => ({ ...t, pickers: [...(t.pickers || []), data] }))
            break
          case 'done': {
            finished = true
            if (data.conversationId) setConversationId(data.conversationId)
            const calls: ToolCall[] = data.toolCalls || []
            patchTurn(assistantId, t => {
              // Keep the streamed timeline (notes + order); attach full outputs from the persisted calls.
              const streamed = t.timeline || []
              const timeline = streamed.length
                ? streamed.map(item => {
                    if (item.kind !== 'tool') return item
                    const c = calls.find(x => x.id === item.step.id)
                    return c ? { ...item, step: { ...item.step, output: c.output, status: c.isError ? 'error' : 'ok' } } : item
                  }) as TimelineItem[]
                : timelineFrom(calls)
              for (const c of calls) {
                if (c.id && !timeline.some(i => i.kind === 'tool' && i.step.id === c.id)) timeline.push(...timelineFrom([c]))
              }
              return {
                ...t,
                streaming: false,
                content: data.message || '',
                model: data.model || undefined,
                provider: data.provider || undefined,
                usage: data.usage,
                toolCalls: calls,
                timeline,
                // Keep a decision the admin already made on a streamed card.
                proposedActions: (data.proposedActions || []).map((a: any) => {
                  const seen = t.proposedActions?.find(x => x.id === a.id)
                  const next = toAction({ ...a, status: 'proposed' }, 'proposed')
                  return seen && seen.status !== 'proposed' ? { ...next, ...seen, blocks: next.blocks ?? seen.blocks } : next
                }),
                pickers: data.pickers || [],
                uiBlocks: data.uiBlocks || [],
              }
            })
            break
          }
          case 'error':
            finished = true
            fail(data.error || 'Agent error')
            break
        }
      }
      if (!finished && !ac.signal.aborted) fail('The connection closed before the answer finished.')
    } catch (err: any) {
      if (ac.signal.aborted) {
        patchTurn(assistantId, t => ({
          ...t,
          streaming: false,
          content: `${t.content.trim()}${t.content.trim() ? '\n\n' : ''}_(stopped)_`,
          retryText: userText,
        }))
      } else {
        fail(err?.message || 'Network error')
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null
      setLoading(false)
      if (isNew && convRef.current) loadConversations()
    }
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim()
    const hasFile = !!pendingFile
    if ((!trimmed && !hasFile) || loading || info.readOnly) return

    let attId = attachmentId
    if (hasFile && !attId) {
      attId = await uploadPendingFile()
      if (!attId) return
    }

    const fileNote = pendingFile ? ` [attachment_id=${attId} filename="${pendingFile.name}" mime=${pendingFile.type}]` : ''
    const finalUserText =
      (trimmed ||
        (hasFile
          ? `Process the attached ${pendingFile?.type.startsWith('image/') ? 'image' : 'PDF'} as a quotation request.`
          : '')) + fileNote
    const displayContent = trimmed || `📎 ${pendingFile?.name || 'attachment'}`

    const assistantId = uid()
    if (!convRef.current) setInfo({ ...NEW_CHAT, title: displayContent.slice(0, 160) })
    setTurns(t => [
      ...t,
      { id: uid(), role: 'user', content: displayContent },
      { id: assistantId, role: 'assistant', content: '', streaming: true, timeline: [] },
    ])
    setInput('')
    clearAttachment()
    await run(finalUserText, assistantId, false)
  }

  async function retry(turnId: string) {
    const turn = turns.find(t => t.id === turnId)
    if (!turn?.retryText || loading || info.readOnly) return
    patchTurn(turnId, t => ({
      ...t,
      content: '',
      error: undefined,
      streaming: true,
      timeline: [],
      uiBlocks: [],
      proposedActions: [],
      pickers: [],
    }))
    await run(turn.retryText, turnId, true)
  }

  function pick(turnId: string, kind: string, option: PickerOption) {
    patchTurn(turnId, t => ({ ...t, pickerResolved: true }))
    sendMessage(`Use ${kind} id ${option.id} (${option.label}) for the previous request.`)
  }

  async function decideAction(turnId: string, actionId: string, decision: 'approve' | 'reject') {
    if (info.readOnly) return
    const setStatus = (patch: Partial<ProposedAction>) =>
      patchTurn(turnId, t => ({
        ...t,
        proposedActions: t.proposedActions?.map(a => (a.id !== actionId ? a : { ...a, ...patch })),
      }))
    setStatus({ status: 'approving', decision })
    try {
      const res = await fetch(`/api/admin/agent/actions/${actionId}/${decision}`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      setStatus({
        status: !res.ok ? 'failed' : decision === 'reject' ? 'rejected' : 'approved',
        result: data.result,
        error: data.error,
      })
      if (!res.ok) showToast(data.error || 'Action failed', 'error')
      else showToast(decision === 'approve' ? 'Action executed' : 'Action rejected', 'success')
    } catch (err: any) {
      setStatus({ status: 'failed', error: err?.message })
      showToast(err?.message || 'Network error', 'error')
    }
  }

  return {
    input,
    setInput,
    loading,
    conversationId,
    info,
    turns,
    setTurns,
    conversations,
    loadingHistory,
    pendingFile,
    uploading,
    attachmentId,
    fileInputRef,
    onPickFile,
    clearAttachment,
    loadConversations,
    loadConversation,
    patchConversation,
    deleteConversation,
    setPageContext: (c: PageContext | null) => {
      pageRef.current = c
    },
    reset,
    stop,
    sendMessage,
    retry,
    pick,
    decideAction,
  }
}

export type AdminAgentChat = ReturnType<typeof useAdminAgentChat>
