'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Tag {
  id: string
  tag: string
  created_at: string
}

interface CustomerTagsProps {
  customerId: string
  initialTags: Tag[]
}

export default function CustomerTags({ customerId, initialTags }: CustomerTagsProps) {
  const router = useRouter()
  const [tags, setTags] = useState<Tag[]>(initialTags)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function add() {
    const trimmed = input.trim()
    if (!trimmed) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: trimmed }),
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to add tag')
      }
      setInput('')
      router.refresh()
      const list = await fetch(`/api/admin/customers/${customerId}/tags`, { credentials: 'include' }).then(r => r.json())
      setTags(list.tags || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(tag: string) {
    setBusy(true)
    try {
      await fetch(`/api/admin/customers/${customerId}/tags?tag=${encodeURIComponent(tag)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      setTags(prev => prev.filter(t => t.tag !== tag))
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-3">Tags</h2>
      <div className="flex flex-wrap gap-2 mb-3">
        {tags.length === 0 ? (
          <p className="text-xs text-foreground-muted italic">No tags yet</p>
        ) : (
          tags.map(t => (
            <span key={t.id} className="inline-flex items-center gap-1 px-2.5 py-1 bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300 rounded-full text-xs font-medium">
              {t.tag}
              <button
                type="button"
                onClick={() => remove(t.tag)}
                disabled={busy}
                aria-label={`Remove tag ${t.tag}`}
                className="ml-0.5 hover:text-accent-900 dark:hover:text-accent-100 disabled:opacity-50"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Add tag (e.g. wholesale-prospect)"
          maxLength={60}
          disabled={busy}
          className="flex-1 min-w-0 px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || !input.trim()}
          className="px-3 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}
