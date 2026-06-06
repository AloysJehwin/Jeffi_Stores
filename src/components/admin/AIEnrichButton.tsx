'use client'

import { useState } from 'react'

interface Props {
  fieldLabel: string
  value: string
  onChange: (value: string) => void
  context?: string
  multiline?: boolean
  children: React.ReactNode // the raw <input> or <textarea>
}

export default function AIEnrichButton({ fieldLabel, value, onChange, context, multiline, children }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prev, setPrev] = useState<string | null>(null)

  async function handleEnrich() {
    if (!value.trim() || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/ai-enrich-field', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldLabel, value, context }),
      })
      const data = await res.json() as { result?: string; error?: string }
      if (!res.ok || !data.result) {
        setError(data.error || 'Enrichment failed')
        return
      }
      setPrev(value)
      onChange(data.result)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  function handleUndo() {
    if (prev !== null) {
      onChange(prev)
      setPrev(null)
      setError(null)
    }
  }

  return (
    <div className="space-y-1">
      <div className={`relative ${multiline ? '' : 'flex items-center'}`}>
        {children}
        <div className={`${multiline ? 'absolute bottom-2 right-2' : 'absolute right-2'} flex items-center gap-1`}>
          {prev !== null && (
            <button
              type="button"
              onClick={handleUndo}
              title="Undo AI enrichment"
              className="inline-flex items-center justify-center w-6 h-6 rounded text-amber-500 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-800/40 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 14L5 10l4-4M5 10h9a5 5 0 010 10H9" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={handleEnrich}
            disabled={loading || !value.trim()}
            title="Enrich with AI"
            className="inline-flex items-center justify-center w-6 h-6 rounded text-violet-500 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-800/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {loading ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {error && (
        <p className="text-[11px] text-red-500 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}
