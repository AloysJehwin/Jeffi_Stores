'use client'

import { useEffect, useState, Fragment } from 'react'
import { CheckCircle, XCircle, Loader2, Sparkles, Play, ChevronDown, ChevronUp } from 'lucide-react'
import Link from 'next/link'
import { useToast } from '@/contexts/ToastContext'
import { EmptyState, ErrorState, InfiniteFooter, PageBody, PageHeader, TableSkeleton, badgeCls, fetchJson, useInfiniteList } from '@/components/admin/kit'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import AdminSelect from '@/components/admin/AdminSelect'
import { ap } from '@/lib/shared/admin-path'
import EnrichmentOverview from './EnrichmentOverview'
import { TabLinks, useListTab } from '../products/_components/catalog-overview'

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
  proposed: badgeCls('amber'),
  approved: badgeCls('green'),
  rejected: badgeCls('red'),
}

function TagList({ tags, max = 4, className = '' }: { tags: string[] | null; max?: number; className?: string }) {
  if (!tags || tags.length === 0) return <span className="text-[10px] text-foreground-muted italic">—</span>
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {tags.slice(0, max).map(t => (
        <span
          key={t}
          className="text-[10px] px-1.5 py-0.5 bg-accent-500/5 text-accent-500 rounded"
        >
          {t}
        </span>
      ))}
      {tags.length > max && <span className="text-[10px] text-foreground-muted">+{tags.length - max}</span>}
    </div>
  )
}

export default function CatalogEnrichmentPage() {
  const { showToast } = useToast()
  const tab = useListTab()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [runningAll, setRunningAll] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'proposed' | 'approved' | 'rejected' | 'all'>('proposed')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const PAGE_SIZE = 25

  const list = useInfiniteList<Item>({
    key: statusFilter,
    pageSize: PAGE_SIZE,
    getKey: i => i.id,
    fetchPage: async (p, signal) => {
      const data = await fetchJson(`/api/admin/catalog-enrichment?status=${statusFilter}&page=${p}&pageSize=${PAGE_SIZE}`, signal)
      return { rows: data.items || [], total: data.total || 0 }
    },
  })
  const items = list.rows
  const loading = list.loading
  useEffect(() => setSelected(new Set()), [statusFilter])

  // A decided item leaves a filtered list; under "all" it just changes status.
  const applyDecision = (ids: string[], decision: 'approve' | 'reject') => {
    const set = new Set(ids)
    const status = decision === 'approve' ? 'approved' : 'rejected'
    list.setRows(rows => (statusFilter === 'all' ? rows.map(r => (set.has(r.id) ? { ...r, status } : r)) : rows.filter(r => !set.has(r.id))))
  }

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
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Action failed')
      showToast(
        decision === 'approve' ? (data.reEmbedded ? 'Approved + re-embedded' : 'Approved') : 'Rejected',
        'success'
      )
      applyDecision([id], decision)
      setSelected(prev => {
        const n = new Set(prev)
        n.delete(id)
        return n
      })
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
      applyDecision([...selected], action)
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
    <PageBody>
      <PageHeader
        media={<Sparkles className="w-5 h-5 text-accent-500" />}
        title="Catalog Enrichment"
        description="AI-generated product intelligence for admin review"
      />

      <TabLinks
        base="/admin/catalog-enrichment"
        active={tab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'list', label: 'Suggestions' },
        ]}
        actions={
          tab === 'list' && (
            <>
              {selected.size > 0 && statusFilter === 'proposed' && (
                <RequireWrite scope="catalog_enrichment:write">
                  <button
                    onClick={() => bulkAction('approve')}
                    disabled={bulkBusy}
                    aria-label={`Approve ${selected.size}`}
                    className="control-md bg-accent-500 hover:bg-accent-600 text-white font-semibold disabled:opacity-50"
                  >
                    {bulkBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle className="w-3.5 h-3.5" />
                    )}
                    <span className="hidden sm:inline">Approve {selected.size}</span>
                  </button>
                  <button
                    onClick={() => bulkAction('reject')}
                    disabled={bulkBusy}
                    aria-label={`Reject ${selected.size}`}
                    className="control-md bg-surface-elevated hover:bg-surface-secondary text-foreground border border-border-default font-semibold disabled:opacity-50"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Reject {selected.size}</span>
                  </button>
                  <div className="w-px h-5 bg-border-default" />
                </RequireWrite>
              )}
              <RequireWrite scope="catalog_enrichment:write">
                <button
                  onClick={runAll}
                  disabled={runningAll}
                  aria-label="Run All"
                  className="control-md bg-surface-elevated hover:bg-surface-secondary text-foreground border border-border-default font-semibold disabled:opacity-50"
                >
                  {runningAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">Run All</span>
                </button>
              </RequireWrite>
            </>
          )
        }
      />

      {tab === 'overview' ? (
        <EnrichmentOverview />
      ) : (
        <>
          <div className="flex justify-end">
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
          {loading && (
            <TableSkeleton rows={8} cols={6} />
          )}

          {!loading && items.length === 0 && list.error && (
            <ErrorState body={list.error} actionNode={<button type="button" onClick={list.retry} className="control-sm border border-border-default text-foreground hover:bg-surface-secondary">Retry</button>} />
          )}
          {!loading && items.length === 0 && !list.error && (
            <EmptyState title={`Nothing in the ${statusFilter} queue.`} body={<>Click <strong>Run All</strong> to enrich products.</>} />
          )}

          {!loading && items.length > 0 && (
            <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border-default bg-surface-secondary/50">
                    <tr>
                      {statusFilter === 'proposed' && (
                        <th className="pl-4 py-3 w-8">
                          <input
                            type="checkbox"
                            checked={allProposedSelected}
                            onChange={toggleAll}
                            aria-label="Select all loaded rows"
                            title="Select all loaded rows"
                            className="rounded border-border-default accent-accent-500"
                          />
                        </th>
                      )}
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-foreground-muted">
                        Product
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-foreground-muted hidden md:table-cell">
                        AI Description
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-foreground-muted hidden lg:table-cell">
                        Use Cases
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-foreground-muted hidden sm:table-cell">
                        Status
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-foreground-muted hidden sm:table-cell">
                        Proposed
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-foreground-muted">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {items.map(item => (
                      <Fragment key={item.id}>
                        <tr
                          className={`hover:bg-surface-secondary/50 transition-colors ${selected.has(item.id) ? 'bg-accent-500/5' : ''}`}
                        >
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
                              <p className="text-[10px] text-accent-500 font-medium mt-0.5">
                                {item.ai_product_type}
                              </p>
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
                            <span
                              className={STATUS_BADGE[item.status] || badgeCls('muted')}
                            >
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
                                {expanded.has(item.id) ? (
                                  <ChevronUp className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                )}
                              </button>
                              {item.status === 'proposed' && (
                                <RequireWrite scope="catalog_enrichment:write">
                                  <button
                                    disabled={busyId === item.id}
                                    onClick={() => decide(item.id, 'approve')}
                                    className="p-1 text-accent-500 hover:text-accent-600 disabled:opacity-50"
                                    title="Approve"
                                  >
                                    {busyId === item.id ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <CheckCircle className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                  <button
                                    disabled={busyId === item.id}
                                    onClick={() => decide(item.id, 'reject')}
                                    className="p-1 text-red-500 hover:text-red-600 disabled:opacity-50"
                                    title="Reject"
                                  >
                                    <XCircle className="w-3.5 h-3.5" />
                                  </button>
                                </RequireWrite>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expanded.has(item.id) && (
                          <tr key={`${item.id}-expanded`} className="bg-surface-secondary/50">
                            <td colSpan={statusFilter === 'proposed' ? 7 : 6} className="px-4 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-[calc(100vw-3rem)] md:max-w-none break-words">
                                {item.source_desc && (
                                  <div>
                                    <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                                      Original Description
                                    </p>
                                    <p className="text-xs text-foreground-muted">{item.source_desc}</p>
                                  </div>
                                )}
                                <div>
                                  <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                                    AI Description
                                  </p>
                                  <p className="text-xs text-foreground">{item.ai_description}</p>
                                </div>
                                {item.ai_application && (
                                  <div>
                                    <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                                      Application
                                    </p>
                                    <p className="text-xs text-foreground">{item.ai_application}</p>
                                  </div>
                                )}
                                {item.ai_who_uses_it && (
                                  <div>
                                    <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                                      Who Uses It
                                    </p>
                                    <p className="text-xs text-foreground">{item.ai_who_uses_it}</p>
                                  </div>
                                )}
                                <div>
                                  <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                                    Use Cases ({item.ai_use_cases.length})
                                  </p>
                                  <TagList tags={item.ai_use_cases} max={20} />
                                </div>
                                {item.ai_keywords && item.ai_keywords.length > 0 && (
                                  <div>
                                    <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                                      Keywords ({item.ai_keywords.length})
                                    </p>
                                    <TagList tags={item.ai_keywords} max={20} />
                                  </div>
                                )}
                                {item.ai_features && item.ai_features.length > 0 && (
                                  <div>
                                    <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                                      Features ({item.ai_features.length})
                                    </p>
                                    <TagList tags={item.ai_features} max={20} />
                                  </div>
                                )}
                                {item.ai_search_tags && item.ai_search_tags.length > 0 && (
                                  <div>
                                    <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                                      Search Tags ({item.ai_search_tags.length})
                                    </p>
                                    <TagList tags={item.ai_search_tags} max={20} />
                                  </div>
                                )}
                                {item.error && (
                                  <div>
                                    <p className="text-[11px] font-semibold text-red-600 uppercase tracking-wide mb-1">
                                      Embed Error
                                    </p>
                                    <p className="text-xs text-red-600 dark:text-red-400">{item.error}</p>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <InfiniteFooter className="px-4 pb-3" shown={items.length} control={list} noun={selected.size > 0 ? `items · ${selected.size} selected` : 'items'} />
            </div>
          )}
        </>
      )}
    </PageBody>
  )
}
