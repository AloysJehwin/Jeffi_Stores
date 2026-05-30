'use client'

import { useEffect, useState } from 'react'

interface TagDef {
  id: string
  tag: string
  color: string
  sort_order: number
}

const COLORS = ['accent', 'blue', 'purple', 'green', 'orange', 'gold', 'red', 'gray', 'teal'] as const
type Color = typeof COLORS[number]

const COLOR_PREVIEW: Record<string, string> = {
  blue:   'bg-blue-500',
  purple: 'bg-purple-500',
  green:  'bg-green-500',
  orange: 'bg-orange-500',
  gold:   'bg-yellow-500',
  red:    'bg-red-500',
  gray:   'bg-zinc-400',
  teal:   'bg-teal-500',
  accent: 'bg-accent-500',
}

const COLOR_BADGE: Record<string, string> = {
  blue:   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  green:  'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  gold:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  red:    'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  gray:   'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  teal:   'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  accent: 'bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300',
}

export default function CustomerTagDefinitionsCard({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [defs, setDefs] = useState<TagDef[]>([])
  const [input, setInput] = useState('')
  const [color, setColor] = useState<Color>('accent')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const res = await fetch('/api/admin/customer-tag-definitions', { credentials: 'include' })
    if (res.ok) {
      const d = await res.json()
      setDefs(d.definitions || [])
    }
  }

  useEffect(() => { load() }, [])

  async function add() {
    const t = input.trim()
    if (!t) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/admin/customer-tag-definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tag: t, color }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed')
      }
      setInput('')
      setColor('accent')
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    try {
      await fetch(`/api/admin/customer-tag-definitions?id=${id}`, { method: 'DELETE', credentials: 'include' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-surface-elevated rounded-xl border border-border-default shadow-sm">
      <div className="px-5 py-4 border-b border-border-default">
        <h2 className="text-sm font-semibold text-foreground">Customer Tags</h2>
        <p className="text-xs text-foreground-muted mt-0.5">Predefined tags that can be assigned to customers.</p>
      </div>
      <div className="p-5 space-y-4">
        {/* Existing tags */}
        <div className="flex flex-wrap gap-2">
          {defs.length === 0 ? (
            <p className="text-xs text-foreground-muted italic">No tags defined yet.</p>
          ) : (
            defs.map(d => (
              <span
                key={d.id}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${COLOR_BADGE[d.color] ?? COLOR_BADGE.accent}`}
              >
                {d.tag}
                {isSuperAdmin && (
                  <button
                    type="button"
                    onClick={() => remove(d.id)}
                    disabled={busy}
                    aria-label={`Remove ${d.tag}`}
                    className="opacity-60 hover:opacity-100 disabled:opacity-30 transition-opacity"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </span>
            ))
          )}
        </div>

        {/* Add new tag — super_admin only */}
        {isSuperAdmin && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
                placeholder="New tag name (e.g. wholesale-prospect)"
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
            {/* Color picker */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-foreground-muted">Color:</span>
              {COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onClick={() => setColor(c)}
                  className={`w-5 h-5 rounded-full transition-all ${COLOR_PREVIEW[c]} ${color === c ? 'ring-2 ring-offset-2 ring-offset-surface-elevated ring-foreground scale-110' : 'opacity-70 hover:opacity-100 hover:scale-110'}`}
                />
              ))}
              <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-medium ${COLOR_BADGE[color]}`}>
                {input.trim() || 'preview'}
              </span>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        )}
      </div>
    </section>
  )
}
