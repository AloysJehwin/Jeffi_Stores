'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Loader2, Sparkles } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import AdminSelect from '@/components/admin/AdminSelect'

interface Item {
  id: string
  product_id: string
  product_name: string
  product_slug: string
  source_desc: string | null
  ai_description: string
  ai_use_cases: string[]
  model: string
  status: string
  proposed_at: string
  promoted_at: string | null
  error: string | null
}

export default function CatalogEnrichmentPage() {
  const { showToast } = useToast()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'proposed' | 'approved' | 'rejected' | 'all'>('proposed')

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/catalog-enrichment?status=${statusFilter}&limit=100`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Load failed')
      setItems(data.items || [])
    } catch (err: any) {
      showToast(err?.message || 'Load failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [statusFilter])

  async function decide(id: string, decision: 'approve' | 'reject') {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/catalog-enrichment/${id}/${decision}`, {
        method: 'POST', credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Action failed')
      if (decision === 'approve') {
        showToast(data.reEmbedded ? 'Approved + re-embedded' : `Approved (embed deferred: ${data.embedError || 'unknown'})`, 'success')
      } else {
        showToast('Rejected', 'success')
      }
      setItems(prev => prev.filter(i => i.id !== id))
    } catch (err: any) {
      showToast(err?.message || 'Action failed', 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-accent-500" />
          <h1 className="text-xl font-bold text-foreground">Catalog Enrichment Queue</h1>
        </div>
        <AdminSelect
          sm
          value={statusFilter}
          onChange={v => setStatusFilter(v as 'proposed' | 'approved' | 'rejected' | 'all')}
          options={[
            { value: 'proposed', label: 'Proposed' },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-foreground-muted py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-center py-12 text-sm text-foreground-muted">
          Nothing in the {statusFilter} queue. Run <code className="font-mono text-xs bg-surface-secondary px-1 py-0.5 rounded">node scripts/enrich-products.mjs --limit=50</code> to stage more.
        </div>
      )}

      <div className="space-y-3">
        {items.map(item => (
          <div key={item.id} className="bg-surface-elevated border border-border-default rounded-xl p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <p className="text-sm font-semibold text-foreground">{item.product_name}</p>
                <p className="text-[10px] text-foreground-muted">model: {item.model} · {new Date(item.proposed_at).toLocaleString()}</p>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                item.status === 'proposed' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200' :
                item.status === 'approved' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200' :
                'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
              }`}>{item.status}</span>
            </div>

            {item.source_desc && (
              <details className="mb-2">
                <summary className="text-[11px] text-foreground-muted cursor-pointer">Original description</summary>
                <p className="text-xs text-foreground-muted mt-1 p-2 bg-surface-secondary rounded">{item.source_desc}</p>
              </details>
            )}

            <div className="mb-2">
              <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">New description</p>
              <p className="text-sm text-foreground">{item.ai_description}</p>
            </div>

            <div className="mb-3">
              <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">Use cases ({item.ai_use_cases.length})</p>
              <div className="flex flex-wrap gap-1">
                {item.ai_use_cases.map(t => (
                  <span key={t} className="text-[10px] px-2 py-0.5 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300 rounded">{t}</span>
                ))}
              </div>
            </div>

            {item.error && (
              <p className="text-[11px] text-red-700 dark:text-red-300 mb-2">Embed error: {item.error}</p>
            )}

            {item.status === 'proposed' && (
              <div className="flex gap-2">
                <button
                  disabled={busyId === item.id}
                  onClick={() => decide(item.id, 'approve')}
                  className="flex-1 px-3 py-1.5 bg-accent-500 hover:bg-accent-600 text-white rounded text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  {busyId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  Approve & re-embed
                </button>
                <button
                  disabled={busyId === item.id}
                  onClick={() => decide(item.id, 'reject')}
                  className="flex-1 px-3 py-1.5 bg-surface hover:bg-surface-secondary text-foreground rounded text-xs font-semibold flex items-center justify-center gap-1 border border-border-default disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5" /> Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
