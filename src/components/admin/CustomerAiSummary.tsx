'use client'

import { useEffect, useState } from 'react'
import { Sparkles, RefreshCw } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'

interface AiSummary {
  summary: string | null
  generatedAt: string | null
}

function relTime(iso: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const sec = Math.round((Date.now() - then) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`
  if (sec < 86400 * 30) return `${Math.round(sec / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function CustomerAiSummary({ customerId, canWrite: canWriteProp = false }: { customerId: string; canWrite?: boolean }) {
  const canWriteScope = useCanWrite('customers:write')
  const canWrite = canWriteProp && canWriteScope
  const [data, setData] = useState<AiSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/admin/customers/${customerId}/ai-summary`, { credentials: 'include' })
        if (!alive) return
        if (res.status === 503) {
          setUnavailable(true)
          return
        }
        if (res.ok) setData(await res.json())
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [customerId])

  async function refresh() {
    setRefreshing(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/ai-summary`, { method: 'POST', credentials: 'include' })
      if (res.status === 503) {
        setError('AI profile generation is not available')
        return
      }
      if (res.ok) setData(await res.json())
      else setError('Could not generate a profile')
    } catch {
      setError('AI profile generation is not available')
    } finally {
      setRefreshing(false)
    }
  }

  if (unavailable) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">About this customer</h2>
        {canWrite && (data?.summary || !loading) && (
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-xs font-medium text-accent-500 hover:text-accent-600 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {data?.summary ? 'Refresh' : 'Generate'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-surface-secondary rounded w-full" />
          <div className="h-3 bg-surface-secondary rounded w-5/6" />
          <div className="h-3 bg-surface-secondary rounded w-2/3" />
        </div>
      ) : data?.summary ? (
        <div className="flex gap-3">
          <Sparkles className="w-4 h-4 text-accent-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">{data.summary}</p>
            {data.generatedAt && (
              <p className="text-[10px] text-foreground-muted mt-2">Generated {relTime(data.generatedAt)}</p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-foreground-muted">No profile yet{canWrite ? '. Use Generate to create one from this customer’s history.' : '.'}</p>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-3">{error}</p>}
    </div>
  )
}
