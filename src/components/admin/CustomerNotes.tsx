'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { NOTE_TAGS, type CustomerNote } from '@/lib/customer-notes-shared'
import NoteAttachments from './NoteAttachments'

interface CustomerNotesProps {
  customerId: string
  initialNotes: CustomerNote[]
  canWrite?: boolean
  orderId?: string | null
  returnRequestId?: string | null
}

const inputClass =
  'w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-sm placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent'

export default function CustomerNotes({
  customerId,
  initialNotes,
  canWrite: canWriteProp = false,
  orderId = null,
  returnRequestId = null,
}: CustomerNotesProps) {
  const router = useRouter()
  const confirm = useConfirm()
  const canWriteScope = useCanWrite('customers:write')
  const canWrite = canWriteProp && canWriteScope
  const [notes, setNotes] = useState<CustomerNote[]>(initialNotes)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [shared, setShared] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const listUrl = () => {
    const p = new URLSearchParams()
    if (orderId) p.set('orderId', orderId)
    if (returnRequestId) p.set('returnRequestId', returnRequestId)
    const qs = p.toString()
    return `/api/admin/customers/${customerId}/notes${qs ? `?${qs}` : ''}`
  }

  async function reload() {
    const list = await fetch(listUrl(), { credentials: 'include' })
      .then(r => r.json())
      .catch(() => ({ notes: [] }))
    setNotes(list.notes || [])
    router.refresh()
  }

  async function add() {
    if (!title.trim() && !body.trim() && files.length === 0) return
    setBusy(true)
    setError('')
    setInfo('')
    try {
      const fd = new FormData()
      fd.set('title', title.trim())
      fd.set('body', body.trim())
      tags.forEach(t => fd.append('tags', t))
      if (orderId) fd.set('orderId', orderId)
      if (returnRequestId) fd.set('returnRequestId', returnRequestId)
      fd.set('shared', shared ? 'true' : 'false')
      files.forEach(f => fd.append('files', f))
      const res = await fetch(`/api/admin/customers/${customerId}/notes`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save note')
      if (Array.isArray(data.warnings) && data.warnings.length)
        setInfo(`Saved, but some files were skipped: ${data.warnings.join('; ')}`)
      setTitle('')
      setBody('')
      setTags([])
      setShared(false)
      setFiles([])
      if (fileRef.current) fileRef.current.value = ''
      await reload()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(noteId: string) {
    const ok = await confirm({
      message: 'Delete this note and its attachments?',
      variant: 'danger',
      confirmLabel: 'Delete',
    })
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

  async function toggleShare(n: CustomerNote) {
    const next = !n.sharedWithCustomer
    if (next) {
      const ok = await confirm({
        message: 'Share this note with the customer? It will appear on their order page.',
        confirmLabel: 'Share',
      })
      if (!ok) return
    }
    const res = await fetch(`/api/admin/customers/${customerId}/notes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ noteId: n.id, shared: next }),
    })
    if (res.ok) setNotes(prev => prev.map(x => (x.id === n.id ? { ...x, sharedWithCustomer: next } : x)))
  }

  async function createTask(n: CustomerNote) {
    const taskTitle = (n.title || n.body || 'Follow up on customer note').slice(0, 255)
    const res = await fetch(`/api/admin/customers/${customerId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ title: taskTitle, description: n.body || null, priority: 'medium' }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Failed to create task')
      return
    }
    setInfo('Task created from note.')
    router.refresh()
  }

  function toggleTag(t: string) {
    setTags(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]))
  }

  return (
    <div>
      {canWrite && (
        <div className="space-y-3 mb-4">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className={inputClass}
            maxLength={200}
          />
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={3}
            placeholder="Write a note about this customer…"
            className={inputClass}
            maxLength={4000}
          />
          <div className="flex flex-wrap gap-1.5">
            {NOTE_TAGS.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => toggleTag(t)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${tags.includes(t) ? 'bg-accent-500 text-white border-accent-500' : 'bg-surface border-border-secondary text-foreground-secondary hover:bg-surface-secondary'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-foreground-secondary cursor-pointer">
              <span className="px-3 py-1.5 rounded-lg border border-border-secondary bg-surface hover:bg-surface-secondary inline-block">
                Attach photos / audio
              </span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,audio/*"
                multiple
                className="hidden"
                onChange={e => setFiles(Array.from(e.target.files || []).slice(0, 8))}
              />
            </label>
            {files.length > 0 && (
              <span className="text-xs text-foreground-muted">
                {files.length} file{files.length === 1 ? '' : 's'} selected
              </span>
            )}
            <label className="flex items-center gap-2 text-xs text-foreground-secondary ml-auto">
              <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} className="rounded" />
              Share with customer
            </label>
            <button
              type="button"
              onClick={add}
              disabled={busy || (!title.trim() && !body.trim() && files.length === 0)}
              className="px-4 py-1.5 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Add Note'}
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          {info && <p className="text-xs text-foreground-muted">{info}</p>}
        </div>
      )}

      {notes.length === 0 ? (
        <p className="text-sm text-foreground-muted">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map(n => (
            <li key={n.id} className="border border-border-default rounded-lg p-3 bg-surface">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {n.title && <p className="text-sm font-semibold text-foreground">{n.title}</p>}
                  {n.body && <p className="text-sm text-foreground-secondary whitespace-pre-wrap">{n.body}</p>}
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {n.tags.map(t => (
                      <span
                        key={t}
                        className="px-2 py-0.5 rounded-full text-[11px] bg-surface-secondary text-foreground-secondary"
                      >
                        {t}
                      </span>
                    ))}
                    {n.source === 'staff_form' && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                        staff form
                      </span>
                    )}
                    {n.sharedWithCustomer && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                        shared with customer
                      </span>
                    )}
                    {n.orderNumber && !orderId && (
                      <span className="text-[11px] text-foreground-muted font-mono">Order {n.orderNumber}</span>
                    )}
                    {n.returnRequestId && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                        return
                      </span>
                    )}
                  </div>
                </div>
                {canWrite && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleShare(n)}
                      className="text-[11px] text-accent-600 hover:underline"
                    >
                      {n.sharedWithCustomer ? 'Unshare' : 'Share'}
                    </button>
                    <button
                      type="button"
                      onClick={() => createTask(n)}
                      className="text-[11px] text-accent-600 hover:underline"
                    >
                      Task
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(n.id)}
                      disabled={busy}
                      className="text-[11px] text-red-600 hover:underline disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
              <NoteAttachments attachments={n.attachments} size="sm" />
              <p className="text-[11px] text-foreground-muted mt-2">
                {n.adminUsername ? `${n.adminUsername} · ` : ''}
                {new Date(n.createdAt).toLocaleString('en-IN')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
