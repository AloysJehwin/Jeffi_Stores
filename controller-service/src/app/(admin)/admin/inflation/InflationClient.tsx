'use client'

import { useEffect, useState, useCallback, useMemo, Fragment } from 'react'
import AdminSelect, { SelectOption } from '@/components/admin/AdminSelect'
import { EmptyState, InfiniteFooter, PageBody, fetchJson, useInfiniteList, PageHeader, TableSkeleton, badgeCls, fieldInputCls, useActionToast } from '@/components/admin/kit'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import InflationHistoryMobileList from './_components/InflationHistoryMobileList'
import InflationOverview from './_components/InflationOverview'
import { TabLinks, useListTab } from '../products/_components/catalog-overview'

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
  const tab = useListTab()
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
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null)
  const [rollingBack, setRollingBack] = useState<string | null>(null)
  const [rollbackError, setRollbackError] = useState<string | null>(null)
  const confirm = useConfirm()
  const canWrite = useCanWrite('financial:write')

  const toast = useActionToast()
  useEffect(() => {
    if (previewError) toast.error(previewError)
  }, [previewError, toast])
  useEffect(() => {
    if (applyError) toast.error(applyError)
  }, [applyError, toast])
  useEffect(() => {
    if (applySuccess) toast.success(applySuccess)
  }, [applySuccess, toast])
  useEffect(() => {
    if (rollbackError) toast.error(rollbackError)
  }, [rollbackError, toast])

  const PAGE_SIZE = 25
  const logList = useInfiniteList<InflationLog>({
    key: 'logs',
    pageSize: PAGE_SIZE,
    getKey: l => l.id,
    fetchPage: async (p, signal) => {
      const data = await fetchJson(`/api/admin/inflation/logs?limit=${PAGE_SIZE}&offset=${(p - 1) * PAGE_SIZE}`, signal)
      return { rows: data.logs || [], total: data.total ?? null }
    },
  })
  const logs = logList.rows
  const pagedLogs = logs
  const logsLoading = logList.loading

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

  const fetchLogs = logList.reload

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
    <PageBody>
      <PageHeader
        title="Price Inflation"
        description="Bulk-increase MRP (ex-GST) by percentage. All derived prices (MRP incl. GST, selling price, wholesale) are recalculated from each product's discount % and GST rate."
      />

      <TabLinks
        base="/admin/inflation"
        active={tab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'list', label: 'Apply and history' },
        ]}
      />

      {tab === 'overview' ? (
        <InflationOverview />
      ) : (
        <>
          <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-6 space-y-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Apply Inflation</h2>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_200px] gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-xs text-foreground-muted">Category *</label>
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
                <label className="mb-1.5 block text-xs font-medium text-xs text-foreground-muted">Brand</label>
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
                <label className="mb-1.5 block text-xs font-medium text-xs text-foreground-muted">
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
                  className={fieldInputCls}
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
                className="control-md border border-border-default bg-surface-elevated text-foreground hover:bg-surface-secondary font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {previewLoading ? 'Loading…' : 'Preview Changes'}
              </button>
              {preview && canWrite && (
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={!canApply || applying}
                  className="control-md bg-accent-500 hover:bg-accent-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {applying ? 'Applying…' : `Apply to ${preview.length} product${preview.length !== 1 ? 's' : ''}`}
                </button>
              )}
            </div>

          </div>

          {preview && preview.length > 0 && (
            <div className="bg-surface-elevated rounded-xl border border-border-default">
              <div className="px-4 sm:px-6 py-4 border-b border-border-default flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Preview — {selectedCategory?.name}</h2>
                <span className="text-xs text-foreground-muted bg-surface px-2.5 py-1 rounded-full border border-border-default">
                  +{percentage}% on MRP (Ex. GST)
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary/50 border-b border-border-default">
                    <tr>
                      <th className="text-left py-2.5 px-4 font-medium text-xs text-foreground-muted">Product / Variant</th>
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
                                  <span className="text-foreground-muted line-through mr-1.5">
                                    {fmt(v.current[c.key])}
                                  </span>
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
            <EmptyState title="No active products found in this category." />
          )}

          <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
            <div className="px-4 sm:px-6 py-4 border-b border-border-default">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Inflation History</h2>
            </div>
            {logsLoading ? (
              <div className="p-4"><TableSkeleton rows={4} cols={5} /></div>
            ) : logs.length === 0 && logList.error ? (
              <div className="p-4">
                <InfiniteFooter shown={0} control={logList} />
              </div>
            ) : logs.length === 0 ? (
              <EmptyState bare title="No inflation applied yet." />
            ) : (
              <div>
                <div className="md:hidden p-4 pt-3 space-y-3">
                  <InflationHistoryMobileList
                    logs={pagedLogs}
                    canWrite={canWrite}
                    rollingBack={rollingBack}
                    onRollback={handleRollback}
                  />
                </div>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-secondary/50 border-b border-border-default">
                      <tr>
                        <th className="text-left py-2.5 px-4 font-medium text-xs text-foreground-muted">Category</th>
                        <th className="text-right py-2.5 px-3 font-medium text-xs text-foreground-muted">%</th>
                        <th className="text-right py-2.5 px-3 font-medium text-xs text-foreground-muted">Products</th>
                        <th className="text-left py-2.5 px-3 font-medium text-xs text-foreground-muted">Applied by</th>
                        <th className="text-left py-2.5 px-3 font-medium text-xs text-foreground-muted">Date</th>
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
                                  <span className={`${badgeCls('amber')} ml-1`}>
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
                                    : 'text-accent-500'
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
                              {new Date(log.applied_at).toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
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
                                  className="control-sm border border-orange-500/40 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
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
                                        <th className="text-left py-2 px-6 font-medium text-xs text-foreground-muted">
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
                </div>
                <InfiniteFooter shown={logs.length} control={logList} noun="runs" className="px-4 pb-3" />
              </div>
            )}
          </div>
        </>
      )}
    </PageBody>
  )
}
