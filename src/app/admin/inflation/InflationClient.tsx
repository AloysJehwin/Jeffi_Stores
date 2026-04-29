'use client'

import { useEffect, useState, useCallback } from 'react'
import AdminSelect, { SelectOption } from '@/components/admin/AdminSelect'

interface Category {
  id: string
  name: string
  parent_category_id: string | null
}

interface PreviewVariant {
  id: string
  variant_name: string
  current: Record<string, number | null>
  projected: Record<string, number | null>
}

interface PreviewProduct {
  id: string
  name: string
  has_variants: boolean
  current: Record<string, number | null>
  projected: Record<string, number | null>
  variants: PreviewVariant[]
}

interface SnapshotVariant {
  id: string
  variant_name: string
  before: Record<string, number | null>
  after: Record<string, number | null>
}

interface SnapshotProduct {
  id: string
  name: string
  has_variants: boolean
  before: Record<string, number | null>
  after: Record<string, number | null>
  variants: SnapshotVariant[]
}

interface InflationLog {
  id: string
  category_name: string
  percentage: number
  applied_fields: string[]
  product_count: number
  applied_by: string
  applied_at: string
  snapshot: SnapshotProduct[] | null
  is_rollback: boolean
  rolled_back_at: string | null
  rolled_back_by: string | null
}

const FIELD_LABELS: Record<string, string> = {
  base_price: 'Selling Price',
  mrp: 'MRP',
  sale_price: 'Sale Price',
  wholesale_price: 'Wholesale Price',
  weight_rate: 'Weight Rate',
  length_rate: 'Length Rate',
}

const ALL_FIELDS = Object.keys(FIELD_LABELS)

function fmt(val: number | null): string {
  if (val == null) return '—'
  return `₹${val.toFixed(2)}`
}

export default function InflationClient({ categories }: { categories: Category[] }) {
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  const [percentage, setPercentage] = useState('')
  const [selectedFields, setSelectedFields] = useState<string[]>(['base_price', 'mrp'])
  const [preview, setPreview] = useState<PreviewProduct[] | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applySuccess, setApplySuccess] = useState<string | null>(null)
  const [logs, setLogs] = useState<InflationLog[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null)
  const [rollingBack, setRollingBack] = useState<string | null>(null)
  const [rollbackError, setRollbackError] = useState<string | null>(null)

  async function handleRollback(log: InflationLog) {
    if (!confirm(`Roll back +${log.percentage}% inflation on "${log.category_name}"? This will restore all ${log.product_count} products to their previous prices.`)) return
    setRollingBack(log.id)
    setRollbackError(null)
    try {
      const res = await fetch('/api/admin/inflation/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ log_id: log.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Rollback failed')
      fetchLogs()
    } catch (e: any) {
      setRollbackError(e.message)
    } finally {
      setRollingBack(null)
    }
  }

  const topCategories = categories.filter(c => !c.parent_category_id)
  const subCategories = categories.filter(c => c.parent_category_id)

  const categoryOptions: SelectOption[] = topCategories.flatMap(parent => {
    const subs = subCategories.filter(s => s.parent_category_id === parent.id)
    return [
      { value: parent.id, label: parent.name },
      ...subs.map(s => ({ value: s.id, label: s.name, group: parent.name, indent: true })),
    ]
  })

  const fetchLogs = useCallback(() => {
    setLogsLoading(true)
    fetch('/api/admin/inflation/logs')
      .then(r => r.json())
      .then(data => setLogs(data.logs || []))
      .catch(() => {})
      .finally(() => setLogsLoading(false))
  }, [])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  function toggleField(f: string) {
    setSelectedFields(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])
    setPreview(null)
  }

  async function handlePreview() {
    if (!selectedCategory || !percentage || selectedFields.length === 0) return
    setPreviewLoading(true)
    setPreviewError(null)
    setPreview(null)
    try {
      const params = new URLSearchParams({
        category_id: selectedCategory.id,
        percentage,
        fields: selectedFields.join(','),
      })
      const res = await fetch(`/api/admin/inflation?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load preview')
      setPreview(data.preview)
    } catch (e: any) {
      setPreviewError(e.message)
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleApply() {
    if (!selectedCategory || !percentage || selectedFields.length === 0 || !preview) return
    setApplying(true)
    setApplyError(null)
    setApplySuccess(null)
    try {
      const res = await fetch('/api/admin/inflation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_id: selectedCategory.id,
          category_name: selectedCategory.name,
          percentage: parseFloat(percentage),
          fields: selectedFields,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to apply inflation')
      setApplySuccess(`+${percentage}% applied to ${data.product_count} product${data.product_count !== 1 ? 's' : ''} in "${selectedCategory.name}".`)
      setPreview(null)
      setPercentage('')
      setSelectedCategory(null)
      fetchLogs()
    } catch (e: any) {
      setApplyError(e.message)
    } finally {
      setApplying(false)
    }
  }

  const pct = parseFloat(percentage)
  const canPreview = !!selectedCategory && !!percentage && pct > 0 && pct <= 100 && selectedFields.length > 0
  const canApply = canPreview && !!preview && preview.length > 0

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Price Inflation</h1>
        <p className="text-foreground-secondary mt-1">Bulk-increase product prices by percentage — select a main category to target all products within it, or a sub-category to target that sub-category only</p>
      </div>

      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6 space-y-5">
        <h2 className="text-lg font-semibold text-foreground">Apply Inflation</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Category *</label>
            <AdminSelect
              value={selectedCategory?.id || ''}
              placeholder="Select a category…"
              options={categoryOptions}
              onChange={val => {
                const cat = categories.find(c => c.id === val) || null
                setSelectedCategory(cat)
                setPreview(null)
              }}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Percentage increase (%) *</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max="100"
              value={percentage}
              onChange={e => { setPercentage(e.target.value); setPreview(null) }}
              placeholder="e.g. 10 for +10%"
              className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
            />
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-foreground-secondary mb-2">Apply to price fields *</p>
          <div className="flex flex-wrap gap-2">
            {ALL_FIELDS.map(f => (
              <button
                key={f}
                type="button"
                onClick={() => toggleField(f)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  selectedFields.includes(f)
                    ? 'bg-accent-500 border-accent-500 text-white'
                    : 'bg-surface border-border-secondary text-foreground-secondary hover:border-accent-400'
                }`}
              >
                {FIELD_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <button
            type="button"
            onClick={handlePreview}
            disabled={!canPreview || previewLoading}
            className="px-4 py-2 bg-secondary-500 hover:bg-secondary-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {previewLoading ? 'Loading…' : 'Preview Changes'}
          </button>
          {preview && (
            <button
              type="button"
              onClick={handleApply}
              disabled={!canApply || applying}
              className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {applying ? 'Applying…' : `Apply to ${preview.length} product${preview.length !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>

        {previewError && <p className="text-sm text-red-600 dark:text-red-400">{previewError}</p>}
        {applyError && <p className="text-sm text-red-600 dark:text-red-400">{applyError}</p>}
        {applySuccess && <p className="text-sm text-green-600 dark:text-green-400 font-medium">{applySuccess}</p>}
      </div>

      {preview && preview.length > 0 && (
        <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-border-default flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Preview — {selectedCategory?.name}</h2>
            <span className="text-xs text-foreground-muted bg-surface px-2.5 py-1 rounded-full border border-border-default">+{percentage}%</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface border-b border-border-default">
                <tr>
                  <th className="text-left py-2.5 px-4 font-medium text-foreground-secondary">Product / Variant</th>
                  {selectedFields.map(f => (
                    <th key={f} className="text-right py-2.5 px-3 font-medium text-foreground-secondary whitespace-nowrap">{FIELD_LABELS[f]}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {preview.map(p => (
                  <>
                    <tr key={p.id} className="bg-surface-elevated/50">
                      <td className="py-2.5 px-4 font-medium text-foreground">{p.name}</td>
                      {selectedFields.map(f => (
                        <td key={f} className="py-2.5 px-3 text-right">
                          {p.has_variants && p.variants.length > 0 ? (
                            <span className="text-foreground-muted text-xs">see variants</span>
                          ) : (
                            <>
                              <span className="text-foreground-muted line-through mr-1.5 text-xs">{fmt(p.current[f])}</span>
                              <span className="text-green-600 dark:text-green-400 font-medium">{fmt(p.projected[f])}</span>
                            </>
                          )}
                        </td>
                      ))}
                    </tr>
                    {p.has_variants && p.variants.map(v => (
                      <tr key={v.id} className="bg-surface">
                        <td className="py-2 px-4 pl-8 text-foreground-secondary text-xs">{v.variant_name}</td>
                        {selectedFields.map(f => (
                          <td key={f} className="py-2 px-3 text-right text-xs">
                            <span className="text-foreground-muted line-through mr-1.5">{fmt(v.current[f])}</span>
                            <span className="text-green-600 dark:text-green-400 font-medium">{fmt(v.projected[f])}</span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {preview && preview.length === 0 && (
        <p className="text-sm text-foreground-muted bg-surface-elevated border border-border-default rounded-lg px-4 py-3">
          No active products found in this category.
        </p>
      )}

      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-border-default">
          <h2 className="text-base font-semibold text-foreground">Inflation History</h2>
          {rollbackError && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{rollbackError}</p>}
        </div>
        {logsLoading ? (
          <p className="p-6 text-sm text-foreground-muted">Loading…</p>
        ) : logs.length === 0 ? (
          <p className="p-6 text-sm text-foreground-muted">No inflation applied yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface border-b border-border-default">
                <tr>
                  <th className="text-left py-2.5 px-4 font-medium text-foreground-secondary">Category</th>
                  <th className="text-right py-2.5 px-3 font-medium text-foreground-secondary">%</th>
                  <th className="text-left py-2.5 px-3 font-medium text-foreground-secondary">Fields</th>
                  <th className="text-right py-2.5 px-3 font-medium text-foreground-secondary">Products</th>
                  <th className="text-left py-2.5 px-3 font-medium text-foreground-secondary">Applied by</th>
                  <th className="text-left py-2.5 px-3 font-medium text-foreground-secondary">Date</th>
                  <th className="py-2.5 px-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {logs.map(log => (
                  <>
                    <tr
                      key={log.id}
                      onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                      className={`transition-colors cursor-pointer ${log.snapshot ? 'hover:bg-surface' : ''} ${expandedLogId === log.id ? 'bg-surface' : ''} ${log.rolled_back_at ? 'opacity-60' : ''}`}
                    >
                      <td className="py-2.5 px-4 font-medium text-foreground">
                        <span className="flex items-center gap-1.5">
                          {log.snapshot && (
                            <svg className={`w-3.5 h-3.5 text-foreground-muted shrink-0 transition-transform ${expandedLogId === log.id ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                          {log.category_name}
                          {log.is_rollback && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 uppercase tracking-wide ml-1">Rollback</span>
                          )}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold">
                        <span className={log.is_rollback ? 'text-orange-600 dark:text-orange-400' : 'text-accent-600 dark:text-accent-400'}>
                          {log.is_rollback ? '−' : '+'}{log.percentage}%
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-foreground-secondary text-xs">{log.applied_fields.map(f => FIELD_LABELS[f] || f).join(', ')}</td>
                      <td className="py-2.5 px-3 text-right text-foreground">{log.product_count}</td>
                      <td className="py-2.5 px-3 text-foreground-secondary">{log.applied_by}</td>
                      <td className="py-2.5 px-3 text-foreground-muted text-xs whitespace-nowrap">
                        {new Date(log.applied_at).toLocaleDateString('en-IN')}{' '}
                        {new Date(log.applied_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        {log.rolled_back_at && (
                          <span className="block text-orange-500 dark:text-orange-400">
                            Rolled back {new Date(log.rolled_back_at).toLocaleDateString('en-IN')}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right" onClick={e => e.stopPropagation()}>
                        {!log.is_rollback && !log.rolled_back_at && log.snapshot && (
                          <button
                            type="button"
                            disabled={rollingBack === log.id}
                            onClick={() => handleRollback(log)}
                            className="px-2.5 py-1 text-xs font-medium rounded border border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                          >
                            {rollingBack === log.id ? 'Rolling back…' : 'Rollback'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedLogId === log.id && log.snapshot && (
                      <tr key={`${log.id}-detail`}>
                        <td colSpan={7} className="p-0 bg-surface border-b border-border-default">
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="bg-surface-secondary border-b border-border-default">
                                <tr>
                                  <th className="text-left py-2 px-6 font-medium text-foreground-secondary">Product / Variant</th>
                                  {log.applied_fields.map(f => (
                                    <th key={f} className="text-right py-2 px-3 font-medium text-foreground-secondary whitespace-nowrap">{FIELD_LABELS[f] || f}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border-default">
                                {log.snapshot.map(p => (
                                  <>
                                    <tr key={p.id} className="bg-surface">
                                      <td className="py-2 px-6 font-medium text-foreground">{p.name}</td>
                                      {log.applied_fields.map(f => (
                                        <td key={f} className="py-2 px-3 text-right">
                                          {p.has_variants && p.variants.length > 0 ? (
                                            <span className="text-foreground-muted">see variants</span>
                                          ) : (
                                            <>
                                              <span className="text-foreground-muted line-through mr-1.5">{fmt(p.before[f])}</span>
                                              <span className="text-green-600 dark:text-green-400 font-medium">{fmt(p.after[f])}</span>
                                            </>
                                          )}
                                        </td>
                                      ))}
                                    </tr>
                                    {p.has_variants && p.variants.map(v => (
                                      <tr key={v.id} className="bg-surface-secondary/50">
                                        <td className="py-1.5 px-6 pl-10 text-foreground-secondary">{v.variant_name}</td>
                                        {log.applied_fields.map(f => (
                                          <td key={f} className="py-1.5 px-3 text-right">
                                            <span className="text-foreground-muted line-through mr-1.5">{fmt(v.before[f])}</span>
                                            <span className="text-green-600 dark:text-green-400 font-medium">{fmt(v.after[f])}</span>
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
