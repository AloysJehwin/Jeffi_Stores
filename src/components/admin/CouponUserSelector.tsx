'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'

interface UserResult {
  id: string
  full_name: string
  email: string
}

interface Props {
  name?: string
}

const SEGMENTS = [
  { key: 'vip',      label: 'VIP',       color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
  { key: 'loyal',    label: 'Loyal',     color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  { key: 'b2b',      label: 'B2B',       color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  { key: 'repeat',   label: 'Repeat',    color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  { key: 'new',      label: 'New',       color: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300' },
  { key: 'at_risk',  label: 'At Risk',   color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
  { key: 'dormant',  label: 'Dormant',   color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400' },
  { key: 'one_time', label: 'One-time',  color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
  { key: 'lead',     label: 'Lead',      color: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300' },
]

const SCORE_BUCKETS = [
  { min: 80, max: 100, label: '80–100', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  { min: 60, max: 80,  label: '60–80',  color: 'bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-300' },
  { min: 40, max: 60,  label: '40–60',  color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
  { min: 20, max: 40,  label: '20–40',  color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
  { min: 0,  max: 20,  label: '0–20',   color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
]

type BulkMode = 'search' | 'segment' | 'score'

export default function CouponUserSelector({ name = 'eligible_user_ids' }: Props) {
  const [mode, setMode] = useState<BulkMode>('search')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<UserResult[]>([])
  const [loading, setLoading] = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkStatus, setBulkStatus] = useState<string | null>(null)
  const [selected, setSelected] = useState<UserResult[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedIds = useMemo(() => new Set(selected.map(u => u.id)), [selected])

  const search = useCallback((val: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.length < 2) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(val)}`)
        const data = await res.json()
        setResults((data.results || []).filter((r: UserResult) => !selectedIds.has(r.id)))
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [selectedIds])

  useEffect(() => { if (mode === 'search') search(q) }, [q, search, mode])

  function addUser(u: UserResult) {
    setSelected(prev => [...prev, u])
    setResults(prev => prev.filter(r => r.id !== u.id))
    setQ('')
  }

  function removeUser(id: string) {
    setSelected(prev => prev.filter(u => u.id !== id))
  }

  async function bulkFetch(params: string, label: string) {
    setBulkLoading(true)
    setBulkStatus(null)
    try {
      const res = await fetch(`/api/admin/coupons/user-pool?${params}`)
      const data = await res.json()
      if (!res.ok) { setBulkStatus(`Error: ${data.error}`); return }
      const users: UserResult[] = data.users || []
      const newUsers = users.filter(u => !selectedIds.has(u.id))
      if (newUsers.length === 0) {
        setBulkStatus(`No new users to add from ${label}`)
      } else {
        setSelected(prev => {
          const existingIds = new Set(prev.map(u => u.id))
          return [...prev, ...newUsers.filter(u => !existingIds.has(u.id))]
        })
        setBulkStatus(`Added ${newUsers.length} user${newUsers.length === 1 ? '' : 's'} from ${label}`)
      }
    } finally {
      setBulkLoading(false)
      setTimeout(() => setBulkStatus(null), 4000)
    }
  }

  const tabClass = (m: BulkMode) =>
    `px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
      mode === m
        ? 'bg-accent-500 text-white'
        : 'bg-surface-secondary text-foreground-secondary hover:bg-border-default'
    }`

  return (
    <div className="space-y-3">
      {/* Hidden inputs */}
      {selected.map(u => (
        <input key={u.id} type="hidden" name={name} value={u.id} />
      ))}

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map(u => (
            <span key={u.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300 text-xs font-medium rounded-full">
              {u.full_name?.trim() || u.email}
              <button type="button" onClick={() => removeUser(u.id)} className="hover:text-red-500 transition-colors leading-none">×</button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setSelected([])}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Mode tabs */}
      <div className="flex items-center gap-1.5">
        <button type="button" className={tabClass('search')} onClick={() => setMode('search')}>Search</button>
        <button type="button" className={tabClass('segment')} onClick={() => setMode('segment')}>By Segment</button>
        <button type="button" className={tabClass('score')} onClick={() => setMode('score')}>By Score</button>
        <button
          type="button"
          disabled={bulkLoading}
          onClick={() => bulkFetch('mode=all', 'all users')}
          className="ml-auto px-3 py-1.5 text-xs font-medium bg-surface-secondary text-foreground-secondary hover:bg-border-default rounded-md transition-colors disabled:opacity-40"
        >
          {bulkLoading ? 'Loading…' : 'All Users'}
        </button>
      </div>

      {/* Search mode */}
      {mode === 'search' && (
        <div className="relative">
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search by name, email or phone…"
            className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <svg className="w-4 h-4 animate-spin text-foreground-muted" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
            </div>
          )}
          {results.length > 0 && (
            <div className="border border-border-secondary rounded-lg overflow-hidden mt-1">
              {results.map(u => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => addUser(u)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 bg-surface hover:bg-surface-secondary text-sm text-left border-b border-border-secondary last:border-0 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">{u.full_name?.trim() || '—'}</p>
                    <p className="text-xs text-foreground-muted truncate">{u.email}</p>
                  </div>
                  <svg className="w-4 h-4 text-accent-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Segment mode */}
      {mode === 'segment' && (
        <div className="flex flex-wrap gap-2">
          {SEGMENTS.map(seg => (
            <button
              key={seg.key}
              type="button"
              disabled={bulkLoading}
              onClick={() => bulkFetch(`mode=segment&segment=${seg.key}`, `${seg.label} segment`)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors disabled:opacity-40 hover:opacity-80 ${seg.color}`}
            >
              {seg.label}
            </button>
          ))}
        </div>
      )}

      {/* Score mode */}
      {mode === 'score' && (
        <div className="space-y-2">
          <p className="text-xs text-foreground-muted">Select users by health score range:</p>
          <div className="flex flex-wrap gap-2">
            {SCORE_BUCKETS.map(b => (
              <button
                key={b.label}
                type="button"
                disabled={bulkLoading}
                onClick={() => bulkFetch(`mode=score&score_min=${b.min}&score_max=${b.max}`, `score ${b.label}`)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors disabled:opacity-40 hover:opacity-80 ${b.color}`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Status message */}
      {bulkStatus && (
        <p className="text-xs text-foreground-secondary">{bulkStatus}</p>
      )}

      {selected.length > 0 && (
        <p className="text-xs text-foreground-muted">{selected.length} user{selected.length === 1 ? '' : 's'} selected</p>
      )}
    </div>
  )
}
