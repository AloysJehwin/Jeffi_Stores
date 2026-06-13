'use client'

import { useEffect, useState, useCallback } from 'react'
import { CheckCircle, XCircle, Loader2, Sparkles, Play, ChevronDown, ChevronUp } from 'lucide-react'
import Link from 'next/link'
import { useToast } from '@/contexts/ToastContext'
import AdminSelect from '@/components/admin/AdminSelect'
import { ap } from '@/lib/admin-path'

interface Item {
  id: string
  product_id: string
  product_name: string
  product_slug: string
  source_desc: string | null
  ai_description: string
  ai_use_cases: string[]
  ai_keywords: string[] | null
  ai_who_uses_it: string | null
  ai_application: string | null
  ai_product_type: string | null
  ai_features: string[] | null
  ai_search_tags: string[] | null
  model: string
  status: string
  proposed_at: string
  promoted_at: string | null
  error: string | null
}

const STATUS_BADGE: Record<string, string> = {
  proposed: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200',
}

function TagList({ tags, max = 4, className = '' }: { tags: string[] | null; max?: number; className?: string }) {
  if (!tags || tags.length === 0) return <span className="text-[10px] text-foreground-muted italic">—</span>
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {tags.slice(0, max).map(t => (
        <span key={t} className="text-[10px] px-1.5 py-0.5 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300 rounded">{t}</span>
      ))}
      {tags.length > max && <span className="text-[10px] text-foreground-muted">+{tags.length - max}</span>}
    </div>
  )
}

export default function CatalogEnrichmentPage() {
  const { showToast } = useToast()
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [runningAll, setRunningAll] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'proposed' | 'approved' | 'rejected' | 'all'>('proposed')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const PAGE_SIZE = 25
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const load = useCallback(async (p = 1) => {
    setLoading(true)
    setSelected(new Set())
    try {
      const res = await fetch(`/api/admin/catalog-enrichment?status=${statusFilter}&page=${p}&pageSize=${PAGE_SIZE}`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Load failed')
      setItems(data.items || [])
      setTotal(data.total || 0)
      setPage(p)
    } catch (err: any) {
      showToast(err?.message || 'Load failed', 'error')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { load(1) }, [load])

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    const proposed = items.filter(i => i.status === 'proposed')
    if (selected.size === proposed.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(proposed.map(i => i.id)))
    }
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function runAll() {
    setRunningAll(true)
    try {
      const res = await fetch('/api/admin/catalog-enrichment/run-all', { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Run failed')
      showToast(data.message || `Queued ${data.queued} products`, 'success')
    } catch (err: any) {
      showToast(err?.message || 'Run failed', 'error')
    } finally {
      setRunningAll(false)
    }
  }

  async function decide(id: string, decision: 'approve' | 'reject') {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/catalog-enrichment/${id}/${decision}`, {
        method: 'POST', credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Action failed')
      showToast(decision === 'approve'
        ? (data.reEmbedded ? 'Approved + re-embedded' : 'Approved')
        : 'Rejected', 'success')
      load(page)
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n })
    } catch (err: any) {
      showToast(err?.message || 'Action failed', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function bulkAction(action: 'approve' | 'reject') {
    if (selected.size === 0) return
    setBulkBusy(true)
    try {
      const res = await fetch('/api/admin/catalog-enrichment/bulk-approve', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected], action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Bulk action failed')
      showToast(`${action === 'approve' ? 'Approved' : 'Rejected'} ${data.processed} items`, 'success')
      load(page)
      setSelected(new Set())
    } catch (err: any) {
      showToast(err?.message || 'Bulk action failed', 'error')
    } finally {
      setBulkBusy(false)
    }
  }

  const proposedItems = items.filter(i => i.status === 'proposed')
  const allProposedSelected = proposedItems.length > 0 && selected.size === proposedItems.length

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent-500" />
            <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Catalog Enrichment</h1>
          </div>
          <p className="text-foreground-secondary mt-1 text-sm">AI-generated product intelligence for admin review</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selected.size > 0 && statusFilter === 'proposed' && (
            <>
              <button
                onClick={() => bulkAction('approve')}
                disabled={bulkBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-500 hover:bg-accent-600 text-white rounded text-xs font-semibold disabled:opacity-50"
              >
                {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                Approve {selected.size}
              </button>
              <button
                onClick={() => bulkAction('reject')}
                disabled={bulkBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-surface-secondary text-foreground border border-border-default rounded text-xs font-semibold disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5" />
                Reject {selected.size}
              </button>
              <div className="w-px h-5 bg-border-default" />
            </>
          )}
          <button
            onClick={runAll}
            disabled={runningAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-surface-secondary text-foreground border border-border-default rounded text-xs font-semibold disabled:opacity-50"
          >
            {runningAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Run All
          </button>
          <AdminSelect
            sm
            value={statusFilter}
            onChange={v => setStatusFilter(v as typeof statusFilter)}
            options={[
              { value: 'proposed', label: 'Proposed' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-foreground-muted py-16 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="bg-surface-elevated border border-border-default rounded-lg p-12 text-center text-sm text-foreground-muted">
          Nothing in the {statusFilter} queue. Click <strong>Run All</strong> to enrich products.
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="bg-surface-elevated border border-border-default rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border-default">
              <thead className="bg-surface-secondary">
                <tr>
                  {statusFilter === 'proposed' && (
                    <th className="pl-4 py-3 w-8">
                      <input
                        type="checkbox"
                        checked={allProposedSelected}
                        onChange={toggleAll}
                        className="rounded border-border-default accent-accent-500"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider hidden md:table-cell">AI Description</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider hidden lg:table-cell">Use Cases</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider hidden sm:table-cell">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider hidden sm:table-cell">Proposed</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {items.map(item => (
                  <>
                    <tr key={item.id} className={`hover:bg-surface-secondary/50 transition-colors ${selected.has(item.id) ? 'bg-accent-50/30 dark:bg-accent-900/10' : ''}`}>
                      {statusFilter === 'proposed' && (
                        <td className="pl-4 py-3 w-8">
                          {item.status === 'proposed' && (
                            <input
                              type="checkbox"
                              checked={selected.has(item.id)}
                              onChange={() => toggleSelect(item.id)}
                              className="rounded border-border-default accent-accent-500"
                            />
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <Link
                          href={ap(`/admin/products/${item.product_id}`)}
                          className="text-sm font-medium text-foreground hover:text-accent-500 transition-colors"
                        >
                          {item.product_name}
                        </Link>
                        {item.ai_product_type && (
                          <p className="text-[10px] text-accent-600 dark:text-accent-400 font-medium mt-0.5">{item.ai_product_type}</p>
                        )}
                        <p className="text-[10px] text-foreground-muted mt-0.5">{item.model}</p>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell max-w-xs">
                        <p className="text-xs text-foreground line-clamp-2">{item.ai_description}</p>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <TagList tags={item.ai_use_cases} max={4} />
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[item.status] || ''}`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-xs text-foreground-muted whitespace-nowrap">
                        {new Date(item.proposed_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => toggleExpand(item.id)}
                            className="p-1 text-foreground-muted hover:text-foreground rounded"
                            title="Expand"
                          >
                            {expanded.has(item.id) ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                          {item.status === 'proposed' && (
                            <>
                              <button
                                disabled={busyId === item.id}
                                onClick={() => decide(item.id, 'approve')}
                                className="p-1 text-accent-500 hover:text-accent-600 disabled:opacity-50"
                                title="Approve"
                              >
                                {busyId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                disabled={busyId === item.id}
                                onClick={() => decide(item.id, 'reject')}
                                className="p-1 text-red-500 hover:text-red-600 disabled:opacity-50"
                                title="Reject"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded.has(item.id) && (
                      <tr key={`${item.id}-expanded`} className="bg-surface-secondary/50">
                        <td colSpan={statusFilter === 'proposed' ? 7 : 6} className="px-4 py-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {item.source_desc && (
                              <div>
                                <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">Original Description</p>
                                <p className="text-xs text-foreground-muted">{item.source_desc}</p>
                              </div>
                            )}
                            <div>
                              <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">AI Description</p>
                              <p className="text-xs text-foreground">{item.ai_description}</p>
                            </div>
                            {item.ai_application && (
                              <div>
                                <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">Application</p>
                                <p className="text-xs text-foreground">{item.ai_application}</p>
                              </div>
                            )}
                            {item.ai_who_uses_it && (
                              <div>
                                <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">Who Uses It</p>
                                <p className="text-xs text-foreground">{item.ai_who_uses_it}</p>
                              </div>
                            )}
                            <div>
                              <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">Use Cases ({item.ai_use_cases.length})</p>
                              <TagList tags={item.ai_use_cases} max={20} />
                            </div>
                            {item.ai_keywords && item.ai_keywords.length > 0 && (
                              <div>
                                <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">Keywords ({item.ai_keywords.length})</p>
                                <TagList tags={item.ai_keywords} max={20} />
                              </div>
                            )}
                            {item.ai_features && item.ai_features.length > 0 && (
                              <div>
                                <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">Features ({item.ai_features.length})</p>
                                <TagList tags={item.ai_features} max={20} />
                              </div>
                            )}
                            {item.ai_search_tags && item.ai_search_tags.length > 0 && (
                              <div>
                                <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">Search Tags ({item.ai_search_tags.length})</p>
                                <TagList tags={item.ai_search_tags} max={20} />
                              </div>
                            )}
                            {item.error && (
                              <div>
                                <p className="text-[11px] font-semibold text-red-600 uppercase tracking-wide mb-1">Embed Error</p>
                                <p className="text-xs text-red-600">{item.error}</p>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-border-default flex items-center justify-between gap-2">
            <div className="text-xs text-foreground-muted">
              {total > 0 && (
                <>Showing <span className="font-medium text-foreground">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}</span> of <span className="font-medium text-foreground">{total}</span></>
              )}
              {selected.size > 0 ? ` · ${selected.size} selected` : ''}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button disabled={page <= 1} onClick={() => load(page - 1)}
                  className="px-3 py-1.5 text-xs font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors">Prev</button>
                <span className="text-xs text-foreground-muted whitespace-nowrap">Page {page} of {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => load(page + 1)}
                  className="px-3 py-1.5 text-xs font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors">Next</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
