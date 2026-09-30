'use client'

import { useEffect, useState, useCallback, useMemo, Fragment } from 'react'
import AdminSelect, { SelectOption } from '@/components/admin/AdminSelect'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'

interface Category {
  id: string
  name: string
  parent_category_id: string | null
}

interface Brand {
  id: string
  name: string
}

interface PriceSnapshot {
  mrp_ex_gst: number | null
  mrp: number | null
  price_ex_gst: number | null
  base_price: number | null
}

interface PreviewVariant {
  id: string
  variant_name: string
  current: PriceSnapshot
  projected: PriceSnapshot
}

interface PreviewProduct {
  id: string
  name: string
  has_variants: boolean
  current: PriceSnapshot
  projected: PriceSnapshot
  variants: PreviewVariant[]
}

interface SnapshotVariant {
  id: string
  variant_name: string
  before: PriceSnapshot
  after: PriceSnapshot
}

interface SnapshotProduct {
  id: string
  name: string
  has_variants: boolean
  before: PriceSnapshot
  after: PriceSnapshot
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

const PREVIEW_COLS: { key: keyof PriceSnapshot; label: string }[] = [
  { key: 'mrp_ex_gst', label: 'MRP (Ex. GST)' },
  { key: 'mrp', label: 'MRP (incl. GST)' },
  { key: 'price_ex_gst', label: 'Selling Price (Ex. GST)' },
  { key: 'base_price', label: 'Selling Price (incl. GST)' },
]

function fmt(val: number | null): string {
  if (val == null) return '—'
  return `₹${val.toFixed(2)}`
}

export default function InflationClient({ categories, brands }: { categories: Category[]; brands: Brand[] }) {
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  const [percentage, setPercentage] = useState('')
  const [productList, setProductList] = useState<
    { id: string; name: string; brand_id: string | null; brand_name: string | null }[]
  >([])
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set())
  const [selectedBrandId, setSelectedBrandId] = useState<string>('')
  const [productListLoading, setProductListLoading] = useState(false)
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
  const confirm = useConfirm()
  const canWrite = useCanWrite('financial:write')

  const PAGE_SIZE = 25
  const [logsPage, setLogsPage] = useState(1)
  const logsTotalPages = Math.max(1, Math.ceil(logs.length / PAGE_SIZE))
  useEffect(() => {
    if (logsPage > logsTotalPages) setLogsPage(logsTotalPages)
  }, [logsPage, logsTotalPages])
  const pagedLogs = useMemo(() => logs.slice((logsPage - 1) * PAGE_SIZE, logsPage * PAGE_SIZE), [logs, logsPage])

  async function loadProducts(category: Category, brandId?: string) {
    setProductListLoading(true)
    setProductList([])
    setSelectedProductIds(new Set())
    setPreview(null)
    try {
      const url = `/api/admin/inflation/products?category_id=${category.id}${brandId ? `&brand_id=${brandId}` : ''}`
      const res = await fetch(url)
      const data = await res.json()
      const list: { id: string; name: string; brand_id: string | null; brand_name: string | null }[] =
        data.products || []
      setProductList(list)
      setSelectedProductIds(new Set(list.map(p => p.id)))
    } catch {
    } finally {
      setProductListLoading(false)
    }
  }

  function toggleProduct(id: string) {
    setSelectedProductIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    setPreview(null)
  }

  function toggleSelectAll() {
    const allFiltered = filteredProductList.map(p => p.id)
    const allSelected = allFiltered.every(id => selectedProductIds.has(id))
    setSelectedProductIds(prev => {
      const next = new Set(prev)
      if (allSelected) {
        allFiltered.forEach(id => next.delete(id))
      } else {
        allFiltered.forEach(id => next.add(id))
      }
      return next
    })
    setPreview(null)
  }

  async function handleRollback(log: InflationLog) {
    const ok = await confirm({
      title: 'Rollback Price Change?',
      message: 'This will restore prices from the snapshot taken at the time of this update. Are you sure?',
      confirmLabel: 'Yes, rollback',
      cancelLabel: 'Cancel',
      variant: 'danger',
    })
    if (!ok) return
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
      { value: parent.id, label: parent.name, group: parent.name },
      ...subs.map(s => ({ value: s.id, label: s.name, group: parent.name, indent: true })),
    ]
  })

  // Brands that actually appear in the loaded product list
  const availableBrands = useMemo(() => {
    const seen = new Map<string, string>()
    productList.forEach(p => {
      if (p.brand_id && p.brand_name) seen.set(p.brand_id, p.brand_name)
    })
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [productList])

  const brandOptions: SelectOption[] = [
    { value: '', label: 'All Brands' },
    ...brands.map(b => ({ value: b.id, label: b.name })),
  ]

  const filteredProductList = useMemo(
    () => (selectedBrandId ? productList.filter(p => p.brand_id === selectedBrandId) : productList),
    [productList, selectedBrandId]
  )

  const fetchLogs = useCallback(() => {
    setLogsLoading(true)
    fetch('/api/admin/inflation/logs')
      .then(r => r.json())
      .then(data => setLogs(data.logs || []))
      .catch(() => {})
      .finally(() => setLogsLoading(false))
  }, [])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  async function handlePreview() {
    if (!selectedCategory || !percentage || selectedProductIds.size === 0) return
    setPreviewLoading(true)
    setPreviewError(null)
    setPreview(null)
    try {
      const params = new URLSearchParams({
        category_id: selectedCategory.id,
        percentage,
        product_ids: [...selectedProductIds].join(','),
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
    if (!selectedCategory || !percentage || !preview || selectedProductIds.size === 0) return
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
          product_ids: [...selectedProductIds],
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to apply inflation')
      setApplySuccess(
        `+${percentage}% applied to ${data.product_count} product${data.product_count !== 1 ? 's' : ''} in "${selectedCategory.name}".`
      )
      setPreview(null)
      setPercentage('')
      setSelectedCategory(null)
      setProductList([])
      setSelectedProductIds(new Set())
      fetchLogs()
    } catch (e: any) {
      setApplyError(e.message)
    } finally {
      setApplying(false)
    }
  }

  const pct = parseFloat(percentage)
  const canPreview = !!selectedCategory && !!percentage && pct > 0 && pct <= 100 && selectedProductIds.size > 0
  const canApply = canPreview && !!preview && preview.length > 0

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Price Inflation</h1>
        <p className="text-foreground-secondary mt-1">
          Bulk-increase MRP (ex-GST) by percentage — all derived prices (MRP incl. GST, selling price, wholesale) are
          automatically recalculated using each product&apos;s discount % and GST rate.
        </p>
      </div>

      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6 space-y-5">
        <h2 className="text-lg font-semibold text-foreground">Apply Inflation</h2>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_200px] gap-4">
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
                if (cat) loadProducts(cat, selectedBrandId || undefined)
                else {
                  setProductList([])
                  setSelectedProductIds(new Set())
                }
              }}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Brand</label>
            <AdminSelect
              value={selectedBrandId}
              placeholder="All Brands"
              options={brandOptions}
              onChange={val => {
                setSelectedBrandId(val)
                setPreview(null)
                if (selectedCategory) loadProducts(selectedCategory, val || undefined)
              }}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1.5">
              Percentage increase (%) *
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max="100"
              value={percentage}
              onChange={e => {
                setPercentage(e.target.value)
                setPreview(null)
              }}
              placeholder="e.g. 10 for +10%"
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
            />
          </div>
        </div>

        {(productListLoading || productList.length > 0) && (
          <div className="border border-border-default rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-surface border-b border-border-default gap-3 flex-wrap">
              <p className="text-sm font-medium text-foreground">
                {productListLoading
                  ? 'Loading products…'
                  : `${selectedProductIds.size} of ${productList.length} product${productList.length !== 1 ? 's' : ''} selected`}
              </p>
              <div className="flex items-center gap-3">
                {!productListLoading && availableBrands.length > 1 && (
                  <div className="w-48">
                    <AdminSelect
                      value={selectedBrandId}
                      placeholder="All Brands"
                      options={brandOptions}
                      onChange={val => {
                        setSelectedBrandId(val)
                        setPreview(null)
                      }}
                    />
                  </div>
                )}
                {!productListLoading && filteredProductList.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="text-xs font-medium text-accent-500 hover:text-accent-600 transition-colors whitespace-nowrap"
                  >
                    {filteredProductList.every(p => selectedProductIds.has(p.id)) ? 'Deselect All' : 'Select All'}
                  </button>
                )}
              </div>
            </div>
            {productListLoading ? (
              <div className="max-h-72 overflow-y-auto divide-y divide-border-default">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-4 py-2.5 animate-pulse"
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <div className="w-4 h-4 rounded bg-surface-secondary shrink-0" />
                    <div className="h-3.5 bg-surface-secondary rounded flex-1" />
                    <div className="h-3 bg-surface-secondary rounded w-16" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y divide-border-default">
                {filteredProductList.map(p => (
                  <label
                    key={p.id}
                    className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-surface transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedProductIds.has(p.id)}
                      onChange={() => toggleProduct(p.id)}
                      className="w-4 h-4 accent-accent-500 rounded"
                    />
                    <span className="text-sm text-foreground">{p.name}</span>
                    {p.brand_name && <span className="text-xs text-foreground-muted ml-auto">{p.brand_name}</span>}
                  </label>
                ))}
                {filteredProductList.length === 0 && (
                  <p className="px-4 py-3 text-sm text-foreground-muted">
                    No products for this brand in the selected category.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-3 items-center">
          <button
            type="button"
            onClick={handlePreview}
            disabled={!canPreview || previewLoading}
            className="px-4 py-2 bg-secondary-500 hover:bg-secondary-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {previewLoading ? 'Loading…' : 'Preview Changes'}
          </button>
          {preview && canWrite && (
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
            <span className="text-xs text-foreground-muted bg-surface px-2.5 py-1 rounded-full border border-border-default">
              +{percentage}% on MRP (Ex. GST)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface border-b border-border-default">
                <tr>
                  <th className="text-left py-2.5 px-4 font-medium text-foreground-secondary">Product / Variant</th>
                  {PREVIEW_COLS.map(c => (
                    <th
                      key={c.key}
                      className="text-right py-2.5 px-3 font-medium text-foreground-secondary whitespace-nowrap"
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {preview.map(p => (
                  <>
                    <tr key={p.id} className="bg-surface-elevated/50">
                      <td className="py-2.5 px-4 font-medium text-foreground">{p.name}</td>
                      {PREVIEW_COLS.map(c => (
                        <td key={c.key} className="py-2.5 px-3 text-right">
                          {p.has_variants && p.variants.length > 0 ? (
                            <span className="text-foreground-muted text-xs">see variants</span>
                          ) : (
                            <>
                              <span className="text-foreground-muted line-through mr-1.5 text-xs">
                                {fmt(p.current[c.key])}
                              </span>
                              <span className="text-green-600 dark:text-green-400 font-medium">
                                {fmt(p.projected[c.key])}
                              </span>
                            </>
                          )}
                        </td>
                      ))}
                    </tr>
                    {p.has_variants &&
                      p.variants.map(v => (
                        <tr key={v.id} className="bg-surface">
                          <td className="py-2 px-4 pl-8 text-foreground-secondary text-xs">{v.variant_name}</td>
                          {PREVIEW_COLS.map(c => (
                            <td key={c.key} className="py-2 px-3 text-right text-xs">
                              <span className="text-foreground-muted line-through mr-1.5">{fmt(v.current[c.key])}</span>
                              <span className="text-green-600 dark:text-green-400 font-medium">
                                {fmt(v.projected[c.key])}
                              </span>
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
                  <th className="text-right py-2.5 px-3 font-medium text-foreground-secondary">Products</th>
                  <th className="text-left py-2.5 px-3 font-medium text-foreground-secondary">Applied by</th>
                  <th className="text-left py-2.5 px-3 font-medium text-foreground-secondary">Date</th>
                  <th className="py-2.5 px-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {pagedLogs.map(log => (
                  <Fragment key={log.id}>
                    <tr
                      onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                      className={`transition-colors cursor-pointer ${log.snapshot ? 'hover:bg-surface' : ''} ${expandedLogId === log.id ? 'bg-surface' : ''} ${log.rolled_back_at ? 'opacity-60' : ''}`}
                    >
                      <td className="py-2.5 px-4 font-medium text-foreground">
                        <span className="flex items-center gap-1.5">
                          {log.snapshot && (
                            <svg
                              className={`w-3.5 h-3.5 text-foreground-muted shrink-0 transition-transform ${expandedLogId === log.id ? 'rotate-90' : ''}`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                          {log.category_name}
                          {log.is_rollback && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 uppercase tracking-wide ml-1">
                              Rollback
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold">
                        <span
                          className={
                            log.is_rollback
                              ? 'text-orange-600 dark:text-orange-400'
                              : 'text-accent-600 dark:text-accent-400'
                          }
                        >
                          {log.is_rollback ? '−' : '+'}
                          {log.percentage}%
                        </span>
                      </td>
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
                        {canWrite && !log.is_rollback && !log.rolled_back_at && log.snapshot && (
                          <button
                            type="button"
                            onClick={() => handleRollback(log)}
                            disabled={rollingBack === log.id}
                            className="px-2.5 py-1 text-xs font-medium rounded border border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {rollingBack === log.id ? 'Rolling back…' : 'Rollback'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedLogId === log.id && log.snapshot && (
                      <tr key={`${log.id}-detail`}>
                        <td colSpan={6} className="p-0 bg-surface border-b border-border-default">
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="bg-surface-secondary border-b border-border-default">
                                <tr>
                                  <th className="text-left py-2 px-6 font-medium text-foreground-secondary">
                                    Product / Variant
                                  </th>
                                  {PREVIEW_COLS.map(c => (
                                    <th
                                      key={c.key}
                                      className="text-right py-2 px-3 font-medium text-foreground-secondary whitespace-nowrap"
                                    >
                                      {c.label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border-default">
                                {log.snapshot.map(p => (
                                  <>
                                    <tr key={p.id} className="bg-surface">
                                      <td className="py-2 px-6 font-medium text-foreground">{p.name}</td>
                                      {PREVIEW_COLS.map(c => (
                                        <td key={c.key} className="py-2 px-3 text-right">
                                          {p.has_variants && p.variants.length > 0 ? (
                                            <span className="text-foreground-muted">see variants</span>
                                          ) : (
                                            <>
                                              <span className="text-foreground-muted line-through mr-1.5">
                                                {fmt(p.before[c.key])}
                                              </span>
                                              <span className="text-green-600 dark:text-green-400 font-medium">
                                                {fmt(p.after[c.key])}
                                              </span>
                                            </>
                                          )}
                                        </td>
                                      ))}
                                    </tr>
                                    {p.has_variants &&
                                      p.variants.map(v => (
                                        <tr key={v.id} className="bg-surface-secondary/50">
                                          <td className="py-1.5 px-6 pl-10 text-foreground-secondary">
                                            {v.variant_name}
                                          </td>
                                          {PREVIEW_COLS.map(c => (
                                            <td key={c.key} className="py-1.5 px-3 text-right">
                                              <span className="text-foreground-muted line-through mr-1.5">
                                                {fmt(v.before[c.key])}
                                              </span>
                                              <span className="text-green-600 dark:text-green-400 font-medium">
                                                {fmt(v.after[c.key])}
                                              </span>
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
                  </Fragment>
                ))}
              </tbody>
            </table>
            {logsTotalPages > 1 && (
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border-default">
                <p className="text-xs text-foreground-muted whitespace-nowrap">
                  Showing{' '}
                  <span className="font-medium text-foreground">
                    {(logsPage - 1) * PAGE_SIZE + 1}–{Math.min(logsPage * PAGE_SIZE, logs.length)}
                  </span>{' '}
                  of <span className="font-medium text-foreground">{logs.length}</span>
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    disabled={logsPage <= 1}
                    onClick={() => setLogsPage(p => Math.max(1, p - 1))}
                    className="px-3 py-1.5 text-xs font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors"
                  >
                    Prev
                  </button>
                  <span className="text-xs text-foreground-muted whitespace-nowrap">
                    Page {logsPage} of {logsTotalPages}
                  </span>
                  <button
                    disabled={logsPage >= logsTotalPages}
                    onClick={() => setLogsPage(p => Math.min(logsTotalPages, p + 1))}
                    className="px-3 py-1.5 text-xs font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
