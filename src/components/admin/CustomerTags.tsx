'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useCanWrite } from '@/contexts/AdminScopesContext'

interface Tag {
  id: string
  tag: string
  created_at: string
}

interface TagDefinition {
  id: string
  tag: string
  color: string
  sort_order: number
}

interface CustomerTagsProps {
  customerId: string
  initialTags: Tag[]
  canWrite?: boolean
}

const COLOR_CLASSES: Record<string, { badge: string; pill: string }> = {
  blue:   { badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',     pill: 'bg-blue-500' },
  purple: { badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300', pill: 'bg-purple-500' },
  green:  { badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',  pill: 'bg-green-500' },
  orange: { badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', pill: 'bg-orange-500' },
  gold:   { badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300', pill: 'bg-yellow-500' },
  red:    { badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',          pill: 'bg-red-500' },
  gray:   { badge: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',         pill: 'bg-zinc-400' },
  teal:   { badge: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',      pill: 'bg-teal-500' },
  accent: { badge: 'bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300', pill: 'bg-accent-500' },
}

function tagClasses(color: string) {
  return COLOR_CLASSES[color] ?? COLOR_CLASSES.accent
}

export default function CustomerTags({ customerId, initialTags, canWrite: canWriteProp = false }: CustomerTagsProps) {
  const router = useRouter()
  const canWriteScope = useCanWrite('customers:write')
  const canWrite = canWriteProp && canWriteScope
  const [tags, setTags] = useState<Tag[]>(initialTags)
  const [definitions, setDefinitions] = useState<TagDefinition[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/admin/customer-tag-definitions', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setDefinitions(d.definitions || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  async function add(tag: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag }),
        credentials: 'include',
      })
      if (res.ok) {
        const list = await fetch(`/api/admin/customers/${customerId}/tags`, { credentials: 'include' }).then(r => r.json())
        setTags(list.tags || [])
        router.refresh()
      }
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

  const assignedSet = new Set(tags.map(t => t.tag))
  const available = definitions.filter(d => !assignedSet.has(d.tag))

  return (
    <div>
      <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-3">Tags</h2>

      {/* Assigned tags */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {tags.length === 0 ? (
          <p className="text-xs text-foreground-muted italic">No tags yet</p>
        ) : (
          tags.map(t => {
            const def = definitions.find(d => d.tag === t.tag)
            const cls = tagClasses(def?.color ?? 'accent')
            return (
              <span
                key={t.id}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${cls.badge}`}
              >
                {t.tag}
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => remove(t.tag)}
                    disabled={busy}
                    aria-label={`Remove tag ${t.tag}`}
                    className="ml-0.5 opacity-60 hover:opacity-100 disabled:opacity-30 transition-opacity"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </span>
            )
          })
        )}
      </div>

      {/* Add tag picker — only visible to write-capable admins */}
      {canWrite && definitions.length > 0 && (
        <div ref={panelRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            disabled={busy || available.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground-muted border border-dashed border-border-secondary rounded-lg hover:border-border-default hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {available.length === 0 ? 'All tags assigned' : 'Add tag'}
          </button>

          {open && available.length > 0 && (
            <div className="absolute z-50 top-full mt-1 left-0 bg-surface-elevated border border-border-default rounded-xl shadow-lg p-2 min-w-[180px] max-w-xs">
              <p className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wider px-2 pb-1.5">Select a tag</p>
              <div className="flex flex-col gap-0.5">
                {available.map(def => {
                  const cls = tagClasses(def.color)
                  return (
                    <button
                      key={def.id}
                      type="button"
                      disabled={busy}
                      onClick={() => { add(def.tag); setOpen(false) }}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm hover:bg-surface-secondary transition-colors disabled:opacity-50 text-left"
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${cls.pill}`} />
                      <span className="text-foreground">{def.tag}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
