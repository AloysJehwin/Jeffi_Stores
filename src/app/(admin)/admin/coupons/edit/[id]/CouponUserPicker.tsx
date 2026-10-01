'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useToast } from '@/contexts/ToastContext'

interface UserResult {
  id: string
  full_name: string
  email: string
}

interface Props {
  onAdd: (user: UserResult) => Promise<void>
  existingIds?: Set<string>
  couponId?: string
}

const SEGMENTS = [
  { key: 'vip', label: 'VIP', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
  { key: 'loyal', label: 'Loyal', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  { key: 'b2b', label: 'B2B', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  { key: 'repeat', label: 'Repeat', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  { key: 'new', label: 'New', color: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300' },
  {
    key: 'at_risk',
    label: 'At Risk',
    color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  },
  { key: 'dormant', label: 'Dormant', color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400' },
  {
    key: 'one_time',
    label: 'One-time',
    color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  },
  { key: 'lead', label: 'Lead', color: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300' },
]

const SCORE_BUCKETS = [
  { min: 80, max: 100, label: '80–100', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  { min: 60, max: 80, label: '60–80', color: 'bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-300' },
  {
    min: 40,
    max: 60,
    label: '40–60',
    color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  },
  {
    min: 20,
    max: 40,
    label: '20–40',
    color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  },
  { min: 0, max: 20, label: '0–20', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
]

type PickerMode = 'search' | 'segment' | 'score'

export default function CouponUserPicker({ onAdd, existingIds = new Set() }: Props) {
  const [pickerMode, setPickerMode] = useState<PickerMode>('search')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<UserResult[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [bulkLoading, setBulkLoading] = useState(false)
  const { showToast } = useToast()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback((val: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.length < 2) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(val)}`)
        const data = await res.json()
        setResults(data.results || [])
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [])

  useEffect(() => {
    if (pickerMode === 'search') search(q)
  }, [q, search, pickerMode])

  async function handleAdd(user: UserResult) {
    setAdding(user.id)
    try {
      await onAdd(user)
      setResults(prev => prev.filter(r => r.id !== user.id))
    } finally {
      setAdding(null)
    }
  }

  async function bulkFetch(params: string, label: string) {
    setBulkLoading(true)
    try {
      const res = await fetch(`/api/admin/coupons/user-pool?${params}`)
      const data = await res.json()
      if (!res.ok) {
        showToast(`Error: ${data.error}`, 'error')
        return
      }
      const users: UserResult[] = (data.users || []).filter((u: UserResult) => !existingIds.has(u.id))
      if (users.length === 0) {
        showToast(`No new users to add from ${label}`, 'info')
      } else {
        for (const u of users) {
          await onAdd(u)
        }
        showToast(`Added ${users.length} user${users.length === 1 ? '' : 's'} from ${label}`, 'success')
      }
    } finally {
      setBulkLoading(false)
    }
  }

  const tabClass = (m: PickerMode) =>
    `px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
      pickerMode === m
        ? 'bg-accent-500 text-white'
        : 'bg-surface-secondary text-foreground-secondary hover:bg-border-default'
    }`

  return (
    <div className="space-y-2">
      {/* Mode tabs */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button type="button" className={tabClass('search')} onClick={() => setPickerMode('search')}>
          Search
        </button>
        <button type="button" className={tabClass('segment')} onClick={() => setPickerMode('segment')}>
          By Segment
        </button>
        <button type="button" className={tabClass('score')} onClick={() => setPickerMode('score')}>
          By Score
        </button>
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
      {pickerMode === 'search' && (
        <>
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
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              </div>
            )}
          </div>
          {results.length > 0 && (
            <div className="border border-border-secondary rounded-lg overflow-hidden">
              {results.map(u => {
                const already = existingIds.has(u.id)
                return (
                  <div
                    key={u.id}
                    className="flex items-center justify-between px-3 py-2.5 bg-surface hover:bg-surface-secondary text-sm border-b border-border-secondary last:border-0"
                  >
                    <div>
                      <p className="font-medium text-foreground">{u.full_name?.trim() || '—'}</p>
                      <p className="text-xs text-foreground-muted">{u.email}</p>
                    </div>
                    <button
                      type="button"
                      disabled={already || adding === u.id}
                      onClick={() => handleAdd(u)}
                      className={`ml-3 px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
                        already
                          ? 'bg-surface-secondary text-foreground-muted cursor-default'
                          : 'bg-accent-500 hover:bg-accent-600 text-white'
                      }`}
                    >
                      {adding === u.id ? '…' : already ? 'Added' : 'Add'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Segment mode */}
      {pickerMode === 'segment' && (
        <div className="flex flex-wrap gap-2 pt-1">
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
      {pickerMode === 'score' && (
        <div className="space-y-1.5 pt-1">
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
    </div>
  )
}
