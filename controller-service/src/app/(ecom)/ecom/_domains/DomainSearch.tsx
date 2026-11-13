'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import { fieldInput, primaryBtn } from '../onboard/ui'
import { inr, type SearchResult } from './types'

const pickBtn = 'inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors disabled:opacity-40'

const TAKEN: Record<string, string> = { TAKEN_HERE: 'Taken', UNAVAILABLE_PREMIUM: 'Premium', DONT_KNOW: 'Unknown' }

/** Type a name, see which domains are free and what each costs a year; pick one. */
export default function DomainSearch({ onPick, picked, pickLabel = 'Choose' }: { onPick: (r: SearchResult) => void; picked?: string | null; pickLabel?: string }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [suggestions, setSuggestions] = useState<SearchResult[]>([])

  async function search(e?: React.FormEvent) {
    e?.preventDefault()
    if (q.trim().length < 2) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/ecom/domains/search?q=${encodeURIComponent(q.trim())}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Search failed')
        setResults(null)
        return
      }
      setResults(data.results ?? [])
      setSuggestions(data.suggestions ?? [])
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  const row = (r: SearchResult) => (
    <li key={r.domain} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 ${picked === r.domain ? 'org-sand rounded-xl px-3 -mx-3' : ''}`}>
      <span className={`min-w-0 flex-1 break-all font-mono text-sm ${r.available ? 'text-foreground' : 'text-foreground-muted line-through'}`}>{r.domain}</span>
      {r.available ? (
        <>
          <span className="text-sm text-foreground tabular-nums">
            <span className="font-semibold">{inr(r.priceInr)}</span>
            <span className="text-foreground-muted">/year</span>
          </span>
          <button type="button" onClick={() => onPick(r)} className={`${pickBtn} ${picked === r.domain ? 'org-sand-hover text-foreground border border-border-default' : 'ecom-accent-bg text-white'}`}>
            {picked === r.domain ? 'Chosen' : pickLabel}
          </button>
        </>
      ) : (
        <span className="text-xs text-foreground-muted">{TAKEN[r.availability] ?? 'Taken'}</span>
      )}
    </li>
  )

  return (
    <div className="space-y-3">
      <form onSubmit={search} className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="yourbrand or yourbrand.in" aria-label="Domain name" className={`${fieldInput} min-w-0 flex-1`} />
        <button type="submit" disabled={busy || q.trim().length < 2} className={primaryBtn}>
          <Search className="h-4 w-4" />
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>
      {error && <p className="text-sm text-[#8a2e1f]">{error}</p>}
      {results && (
        <div>
          {results.length === 0 ? (
            <p className="text-sm text-foreground-muted">No matching domains.</p>
          ) : (
            <ul className="divide-y divide-border-default/60">{results.map(row)}</ul>
          )}
          {suggestions.length > 0 && (
            <>
              <div className="mt-3 text-xs uppercase tracking-widest text-foreground-muted">Other ideas</div>
              <ul className="divide-y divide-border-default/60">{suggestions.map(row)}</ul>
            </>
          )}
          <p className="mt-2 text-xs text-foreground-muted">Prices are per year and renew at the same rate. Paid from your wallet.</p>
        </div>
      )}
    </div>
  )
}
