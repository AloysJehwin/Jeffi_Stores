'use client'

import { useEffect, useRef, useState } from 'react'
import { Sparkles, Search, X, AlertTriangle } from 'lucide-react'
import { fieldInputCls } from '@/components/admin/kit'
import { useCanWrite } from '@/contexts/AdminScopesContext'

interface Entry {
  id: number
  path: string
}

const API = '/api/admin/categories/google-taxonomy'

/** Google product taxonomy field: search the official list, or auto-match from the category's name. Blank = auto on save. */
export default function GoogleTaxonomyPicker({
  name,
  defaultValue,
  categoryName,
  description,
}: {
  name: string
  defaultValue?: string | null
  categoryName: string
  description: string
}) {
  const canWrite = useCanWrite('categories:write')
  const [value, setValue] = useState(defaultValue || '')
  const [valid, setValid] = useState<boolean | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Entry[]>([])
  const [open, setOpen] = useState(false)
  const [matching, setMatching] = useState(false)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!value) return setValid(null)
    fetch(`${API}?value=${encodeURIComponent(value)}`)
      .then(r => r.json())
      .then(d => setValid(!!d.match))
      .catch(() => setValid(null))
  }, [value])

  useEffect(() => {
    if (query.trim().length < 2) return setResults([])
    const t = setTimeout(() => {
      fetch(`${API}?q=${encodeURIComponent(query)}`)
        .then(r => r.json())
        .then(d => setResults(d.results || []))
        .catch(() => setResults([]))
    }, 200)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  async function autoMatch() {
    setError('')
    setMatching(true)
    try {
      const parentId = (root.current?.closest('form')?.elements.namedItem('parent_id') as HTMLInputElement | null)?.value
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: categoryName, description, parent_id: parentId || null }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Could not match')
      if (!d.match) throw new Error('No matching Google category found — search for one instead')
      setValue(d.match.path)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setMatching(false)
    }
  }

  function pick(e: Entry) {
    setValue(e.path)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={root} className="relative">
      <input type="hidden" name={name} value={value} />
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
          <input
            type="text"
            id={name}
            value={open ? query : value}
            onChange={e => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            className={`${fieldInputCls} pl-9 pr-8`}
            placeholder="Search Google categories, or leave blank to auto-assign on save"
            autoComplete="off"
          />
          {value && !open && (
            <button
              type="button"
              aria-label="Clear Google category"
              onClick={() => setValue('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={autoMatch}
            disabled={matching || !categoryName.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {matching ? 'Matching…' : 'Auto-match'}
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-surface-elevated py-1 shadow-lg">
          {results.map(r => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => pick(r)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-secondary"
              >
                <span className="text-foreground">{r.path.split(' > ').pop()}</span>
                <span className="block text-xs text-foreground-muted">
                  {r.path} · #{r.id}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {valid === false && !open && (
        <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5" />
          Not an official Google category — it will be re-matched automatically when you save.
        </p>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
