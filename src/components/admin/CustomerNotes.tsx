'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useConfirm } from '@/contexts/ConfirmContext'

interface Note {
  id: string
  body: string
  created_at: string
  admin_username: string | null
  admin_first_name: string | null
  admin_last_name: string | null
}

interface CustomerNotesProps {
  customerId: string
  initialNotes: Note[]
  canWrite?: boolean
}

export default function CustomerNotes({ customerId, initialNotes, canWrite = false }: CustomerNotesProps) {
  const router = useRouter()
  const confirm = useConfirm()
  const [notes, setNotes] = useState<Note[]>(initialNotes)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function add() {
    const trimmed = body.trim()
    if (!trimmed) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save note')
      }
      setBody('')
      router.refresh()
      const list = await fetch(`/api/admin/customers/${customerId}/notes`, { credentials: 'include' }).then(r => r.json())
      setNotes(list.notes || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(noteId: string) {
    const ok = await confirm({ message: 'Delete this note?', variant: 'danger', confirmLabel: 'Delete' })
    if (!ok) return
    setBusy(true)
    try {
      await fetch(`/api/admin/customers/${customerId}/notes?noteId=${noteId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      setNotes(prev => prev.filter(n => n.id !== noteId))
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  function fmt(date: string) {
    const d = new Date(date)
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  function authorName(n: Note) {
    if (n.admin_first_name || n.admin_last_name) {
      return `${n.admin_first_name || ''} ${n.admin_last_name || ''}`.trim()
    }
    return n.admin_username || 'Admin'
  }

  return (
    <div>
      <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-3">Internal Notes</h2>
      {canWrite && (
      <div className="space-y-2 mb-3">
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Add an internal note (visible to admins only)…"
          maxLength={2000}
          rows={3}
          disabled={busy}
          className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500 resize-none"
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-foreground-muted">{body.length}/2000</span>
          <button
            type="button"
            onClick={add}
            disabled={busy || !body.trim()}
            className="px-3 py-1.5 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save Note
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      )}

      {notes.length === 0 ? (
        <p className="text-xs text-foreground-muted italic">No notes yet</p>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
          {notes.map(n => (
            <div key={n.id} className="border-l-2 border-accent-500 pl-3 py-1 group">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-foreground whitespace-pre-wrap break-words">{n.body}</p>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => remove(n.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-foreground-muted hover:text-red-600 shrink-0"
                    aria-label="Delete note"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22" />
                    </svg>
                  </button>
                )}
              </div>
              <p className="text-[10px] text-foreground-muted mt-1">
                {authorName(n)} · {fmt(n.created_at)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
