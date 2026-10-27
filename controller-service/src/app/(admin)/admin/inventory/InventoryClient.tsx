'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AdminSelect from '@/components/admin/AdminSelect'
import HoverCard from '@/components/ui/HoverCard'
import { SortTh, useListSort, type SortCol } from '@/components/admin/kit/list-sort'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { ap } from '@/lib/shared/admin-path'
import { formatDate } from '@/lib/shared/format'
import CopySku from '@/components/ui/CopySku'
import { useCanWrite, useHasScope } from '@/contexts/AdminScopesContext'
import { Tabs } from '@/components/admin/kit/core'
import { TableSkeleton } from '@/components/admin/kit/states'
import { InfiniteFooter, fetchJson, useInfiniteList } from '@/components/admin/kit/infinite'
import { ListFilters, useFilterQuery } from '@/components/admin/kit/list-filters'
import {
  LEDGER_ALIASES,
  LEDGER_COUNT_CAP,
  LEDGER_FIELDS,
  PRODUCT_SEARCH,
  VALUATION_ALIASES,
  VALUATION_FIELDS,
} from '@/lib/filters/fields/inventory'
import InventoryOverviewTab from './_components/InventoryOverviewTab'
import { STOCK_PAGE_SIZE, VALUATION_PAGE_SIZE, formatINR, SummaryCard, TYPE_BADGE } from '@/components/admin/purchasing/shared'

type StockTransaction = {
  id: string
  created_at: string
  transaction_type: string
  quantity_change: number
  quantity_after: number
  reference_type: string
  reference_id: string
  notes: string | null
  unit_id: string | null
  unit_label: string | null
  unit_factor: number | null
  quantity_in_unit: number | null
  product_id: string
  product_name: string
  product_sku: string | null
  variant_id: string | null
  variant_name: string | null
  sub_variant_id: string | null
  sub_variant_name: string | null
  reference_label: string | null
  batch_id: string | null
  lot_number: string | null
  expiry_date: string | null
  serial_number: string | null
}

type StockView = 'ledger' | 'valuation'

const LEDGER_SORT_COLS: SortCol[] = [
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'product', label: 'Product' },
  { key: 'type', label: 'Type' },
  { key: 'change', label: 'Change', type: 'number' },
  { key: 'balance', label: 'Balance', type: 'number' },
  { key: 'reference', label: 'Reference' },
  { key: 'batch', label: 'Batch' },
]

const SORT_TH = 'px-6 py-3 text-xs font-medium text-foreground-muted uppercase tracking-wider'

const VAL_SORT_COLS: SortCol[] = [
  { key: 'product', label: 'Product' },
  { key: 'variant', label: 'Variant' },
  { key: 'sku', label: 'SKU' },
  { key: 'stock', label: 'Stock', type: 'number' },
  { key: 'unit', label: 'Sell Unit' },
  { key: 'price', label: 'Price ex-GST', type: 'number' },
  { key: 'gst', label: 'GST %', type: 'number' },
  { key: 'value', label: 'Stock Value (ex-GST)', type: 'number' },
  { key: 'value_incl', label: 'Stock Value (incl. GST)', type: 'number' },
]

function StockTab({ view }: { view: StockView }) {
  const canFinancial = useHasScope('financial:read')
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canWrite = useCanWrite('inventory')
  const [valuation, setValuation] = useState<{
    products: any[]
    total: number
    totalValue: number
    totalValueInclGst?: number
    inStockCount?: number
    allCategories?: string[]
    allBrands?: string[]
  } | null>(null)
  // Each tab's filters live in the URL (old ledger_* / val_* names are rewritten).
  const ledgerFilters = useFilterQuery(LEDGER_FIELDS, { aliases: LEDGER_ALIASES })
  const valFilters = useFilterQuery(VALUATION_FIELDS, { aliases: VALUATION_ALIASES })
  const [ledgerMeta, setLedgerMeta] = useState<{ window: { from: string; days: number } | null; capped: boolean } | null>(null)
  const [expandedValRows, setExpandedValRows] = useState<Record<string, any[] | null>>({})
  const [loadingBatchRow, setLoadingBatchRow] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editUnits, setEditUnits] = useState<
    { id: string; unit: string; display_label: string | null; factor: number; dimension: string }[]
  >([])
  const [editUnitId, setEditUnitId] = useState<string>('')
  const [editWarehouses, setEditWarehouses] = useState<{ id: string; name: string; code: string }[]>([])
  const [editWarehouseId, setEditWarehouseId] = useState('')
  const [editLocationId, setEditLocationId] = useState('')
  const [editLocations, setEditLocations] = useState<{ id: string; display_code: string; is_open_shelf: boolean }[]>([])
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [expandedSerialProducts, setExpandedSerialProducts] = useState<Set<string>>(new Set())
  const [expandedValProducts, setExpandedValProducts] = useState<Set<string>>(new Set())
  const [expandedValVariants, setExpandedValVariants] = useState<Set<string>>(new Set())

  function toggleValProduct(id: string) {
    setExpandedValProducts(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function toggleValVariant(id: string) {
    setExpandedValVariants(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function toggleSerialProduct(key: string) {
    setExpandedSerialProducts(prev => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  }

  function toggleGroup(refId: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(refId)) next.delete(refId)
      else next.add(refId)
      return next
    })
  }

  async function toggleValBatch(
    rowId: string,
    productId: string,
    variantId: string | null,
    subVariantId: string | null
  ) {
    if (expandedValRows[rowId] !== undefined) {
      setExpandedValRows(prev => {
        const n = { ...prev }
        delete n[rowId]
        return n
      })
      return
    }
    setLoadingBatchRow(rowId)
    const params = new URLSearchParams({ view: 'batch_valuation', product_id: productId })
    if (variantId) params.set('variant_id', variantId)
    if (subVariantId) params.set('sub_variant_id', subVariantId)
    const res = await fetch(`/api/admin/inventory/stock?${params}`)
    const json = await res.json()
    setExpandedValRows(prev => ({ ...prev, [rowId]: json?.batches || [] }))
    setLoadingBatchRow(null)
  }

  // Both tabs sort server-side via ?sort&dir (each API ignores keys it doesn't know).
  const { sort, dir } = useListSort()
  const sortParams = (p: URLSearchParams) => {
    if (sort) {
      p.set('sort', sort)
      p.set('dir', dir)
    }
  }

  // Ledger groups are rebuilt from every loaded row, so a group split across pages merges.
  const txList = useInfiniteList<StockTransaction>({
    key: view === 'ledger' ? `${ledgerFilters}|${sort}|${dir}` : null,
    pageSize: STOCK_PAGE_SIZE,
    getKey: t => t.id,
    fetchPage: async (pg, signal) => {
      const params = new URLSearchParams(ledgerFilters)
      params.set('view', 'ledger')
      params.set('page', String(pg))
      params.set('limit', String(STOCK_PAGE_SIZE))
      sortParams(params)
      const json = await fetchJson(`/api/admin/inventory/stock?${params}`, signal)
      if (pg === 1) setLedgerMeta({ window: json?.window ?? null, capped: !!json?.capped })
      return { rows: json?.transactions || [], total: json?.total || 0 }
    },
  })
  const transactions = txList.rows

  // Totals and filter options come with page 1; later pages only add rows.
  const valList = useInfiniteList<any>({
    key: view === 'valuation' ? `${valFilters}|${sort}|${dir}` : null,
    pageSize: VALUATION_PAGE_SIZE,
    fetchPage: async (pg, signal) => {
      const params = new URLSearchParams(valFilters)
      params.set('view', 'valuation')
      params.set('page', String(pg))
      params.set('limit', String(VALUATION_PAGE_SIZE))
      sortParams(params)
      const json = await fetchJson(`/api/admin/inventory/stock?${params}`, signal)
      if (pg === 1) setValuation(json)
      return { rows: json?.products || [], total: json?.total || 0 }
    },
  })
  const loading = view === 'ledger' ? txList.loading : valList.loading

  // Group by reference_id, preserving order of first appearance
  // refId is a COMPOSITE grouping key (reference_id + type [+ timestamp]); it is
  // not addressable. linkId is the bare reference_id for building URLs.
  const ledgerGroups: {
    refId: string
    linkId: string | null
    refType: string
    refLabel: string | null
    date: string
    txs: StockTransaction[]
  }[] = []
  for (const tx of transactions) {
    // Group by reference_id + transaction_type so sale and return events for the
    // same order appear as separate groups instead of netting to 0.
    // Manual adjustments carry the PRODUCT id as reference_id, so every adjustment
    // ever made to a product would otherwise collapse into one group across dates —
    // key those by timestamp instead, which is what one save actually shares.
    // Fall back to tx.id for rows with no reference_id (legacy rows).
    const groupKey =
      tx.reference_type === 'manual'
        ? `${tx.reference_id || tx.id}::${tx.transaction_type}::${tx.created_at}`
        : tx.reference_id
          ? `${tx.reference_id}::${tx.transaction_type}`
          : tx.id
    const existing = ledgerGroups.find(g => g.refId === groupKey)
    if (existing) {
      existing.txs.push(tx)
      if (tx.created_at > existing.date) existing.date = tx.created_at
    } else {
      ledgerGroups.push({
        refId: groupKey,
        linkId: tx.reference_id || null,
        refType: tx.reference_type,
        refLabel: tx.reference_label,
        date: tx.created_at,
        txs: [tx],
      })
    }
  }

  // The server orders rows by ITS group key, which lumps every manual adjustment for
  // a product into one block. Splitting those by timestamp above creates groups the
  // server never ordered, so re-sort by each group's own newest event (unless a sort was picked).
  if (!LEDGER_SORT_COLS.some(c => c.key === sort)) ledgerGroups.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const allValRows = valList.rows
  const valTotal = valuation?.total || 0

  // Rows are sorted server-side (across all SKUs) via ?sort&dir, so render as-is.
  const sortedValRows = allValRows

  const valTree = useMemo(() => {
    const num = (v: any) => parseFloat(v || '0') || 0
    const leafValueEx = (r: any) => num(r.inventory_quantity) * num(r.cost_price)
    const leafValueIncl = (r: any) => num(r.inventory_quantity) * num(r.selling_price)

    type ValLeaf = any
    type ValVariant = {
      variantId: string
      leaf: ValLeaf | null
      subVariants: ValLeaf[]
      stock: number
      valueEx: number
      valueIncl: number
    }
    type ValProduct = {
      productId: string
      head: ValLeaf
      simpleLeaf: ValLeaf | null
      variants: ValVariant[]
      stock: number
      valueEx: number
      valueIncl: number
    }

    const products: ValProduct[] = []
    const byProduct = new Map<string, ValProduct>()

    for (const r of sortedValRows) {
      const pid = String(r.id)
      let prod = byProduct.get(pid)
      if (!prod) {
        prod = { productId: pid, head: r, simpleLeaf: null, variants: [], stock: 0, valueEx: 0, valueIncl: 0 }
        byProduct.set(pid, prod)
        products.push(prod)
      }
      prod.stock += num(r.inventory_quantity)
      prod.valueEx += leafValueEx(r)
      prod.valueIncl += leafValueIncl(r)

      if (!r.variant_id) {
        prod.simpleLeaf = r
        continue
      }

      const vid = String(r.variant_id)
      let variant = prod.variants.find(v => v.variantId === vid)
      if (!variant) {
        variant = { variantId: vid, leaf: null, subVariants: [], stock: 0, valueEx: 0, valueIncl: 0 }
        prod.variants.push(variant)
      }
      variant.stock += num(r.inventory_quantity)
      variant.valueEx += leafValueEx(r)
      variant.valueIncl += leafValueIncl(r)

      if (r.sub_variant_id) {
        variant.subVariants.push(r)
      } else {
        variant.leaf = r
      }
    }

    return products
  }, [sortedValRows])

  function startEdit(p: any) {
    const rowId = p.sub_variant_id || p.variant_id || p.id
    setEditingId(rowId)
    setEditNotes('')
    setEditWarehouseId('')
    setEditLocationId('')
    setEditLocations([])

    // Fetch warehouses for shelf assignment, then pre-select existing shelf
    const variantParam = p.sub_variant_id
      ? `&sub_variant_id=${p.sub_variant_id}`
      : p.variant_id
        ? `&variant_id=${p.variant_id}`
        : ''
    Promise.all([
      fetch('/api/admin/shelving/warehouses', { credentials: 'include' }).then(r => r.json()),
      fetch(`/api/admin/shelving/stock?product_id=${p.id}${variantParam}`, { credentials: 'include' }).then(r =>
        r.json()
      ),
    ])
      .then(([wj, sj]) => {
        const warehouses = wj.warehouses || []
        setEditWarehouses(warehouses)
        const existing = (sj.locations || [])[0]
        if (existing?.warehouse_id) {
          setEditWarehouseId(existing.warehouse_id)
          // editLocations will be populated by the useEffect on editWarehouseId;
          // store the location_id so it can be selected after locations load
          setEditLocationId(existing.location_id)
        }
      })
      .catch(() => {})

    // Build unit options from the valuation row data
    const sellFactor = parseFloat(p.sell_unit_factor || '1') || 1
    const units: { id: string; unit: string; display_label: string | null; factor: number; dimension: string }[] = []

    // We don't have unit IDs in the valuation row — fetch them from the units API
    const apiPath =
      p.sub_variant_id && p.variant_id
        ? `/api/admin/products/${p.id}/variants/${p.variant_id}/sub-variants/${p.sub_variant_id}/units`
        : p.variant_id
          ? `/api/admin/products/${p.id}/variants/${p.variant_id}/units`
          : `/api/admin/products/${p.id}/units`

    // Default: show base-unit qty while units load
    const currentBase = parseFloat(p.inventory_quantity || '0')
    setEditQty(String(currentBase))
    setEditUnits([])
    setEditUnitId('')

    fetch(apiPath)
      .then(r => r.json())
      .then(json => {
        const fetched = (json?.units || []).map((u: any) => ({
          id: u.id,
          unit: u.unit,
          display_label: u.display_label,
          factor: parseFloat(u.factor) || 1,
          dimension: u.dimension,
        }))
        // For sub-variants, also try sub-variant-specific units if present; fall back to variant/product
        setEditUnits(fetched)
        // For count-dimension, always pre-select the base (pc, factor=1) unit so
        // the operator enters raw piece count — no unwanted multiplication.
        // For other dimensions, match by factor to the valuation row's sell unit.
        const isCount = p.sell_unit_dimension === 'count'
        const match = isCount
          ? fetched.find((u: any) => u.factor === 1 && u.dimension === 'count') ||
            fetched.find((u: any) => u.dimension === 'count') ||
            fetched[0]
          : fetched.find((u: any) => Math.abs(u.factor - sellFactor) < 0.0001) || fetched[0]
        if (match) {
          setEditUnitId(match.id)
          // Pre-fill qty as sell-unit qty only for non-count units with factor > 1
          if (!isCount && match.factor > 1) {
            setEditQty(String(Math.round((currentBase / match.factor) * 1000) / 1000))
          }
        }
      })
      .catch(() => {})
  }

  async function saveEdit(p: any) {
    setEditSaving(true)
    const selectedUnit = editUnits.find(u => u.id === editUnitId)
    const body: Record<string, any> = {
      product_id: p.id,
      variant_id: p.variant_id || null,
      sub_variant_id: p.sub_variant_id || null,
      notes: editNotes || undefined,
      ...(editWarehouseId ? { warehouse_id: editWarehouseId } : {}),
      ...(editWarehouseId && editLocationId ? { location_id: editLocationId } : {}),
    }
    // Count-dimension units are always stored as raw pcs — never multiply via unit_id path
    const isCountUnit = !selectedUnit || selectedUnit.dimension === 'count' || selectedUnit.factor === 1
    if (!isCountUnit) {
      body.unit_id = selectedUnit!.id
      body.quantity_in_unit = parseFloat(editQty)
    } else {
      body.new_quantity = parseFloat(editQty)
    }
    await fetch('/api/admin/inventory/stock', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setEditSaving(false)
    setEditingId(null)
    valList.reload()
  }

  function cancelEdit() {
    setEditingId(null)
    setEditQty('')
    setEditNotes('')
    setEditUnits([])
    setEditUnitId('')
    setEditWarehouseId('')
    setEditLocationId('')
    setEditLocations([])
  }

  useEffect(() => {
    if (!editWarehouseId) {
      setEditLocations([])
      setEditLocationId('')
      return
    }
    fetch(`/api/admin/shelving/locations?warehouse_id=${editWarehouseId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(j => {
        setEditLocations(j.locations || [])
        // Only reset location if not already pre-seeded by startEdit
        setEditLocationId(prev => {
          const locs: { id: string }[] = j.locations || []
          return locs.some(l => l.id === prev) ? prev : ''
        })
      })
      .catch(() => {})
  }, [editWarehouseId])

  function renderValLeaf(p: any, firstCell: React.ReactNode, variantCell: React.ReactNode) {
    const rowId = p.sub_variant_id || p.variant_id || p.id
    const isEditing = editingId === rowId
    return (
      <React.Fragment key={rowId}>
        <tr
          className={`hover:bg-surface-secondary/50 transition-colors ${isEditing ? 'bg-surface-secondary/40' : ''}`}
        >
          <td className="px-4 py-3 font-medium text-foreground">{firstCell}</td>
          <td className="px-4 py-3 text-foreground-secondary hidden sm:table-cell">{variantCell}</td>
          <td className="px-4 py-3 font-mono text-xs text-foreground-secondary hidden md:table-cell">
            <span className="inline-flex items-center gap-1">
              {p.row_sku || p.sku || '—'}
              {(p.row_sku || p.sku) && <CopySku sku={p.row_sku || p.sku} />}
            </span>
          </td>
          <td className="px-4 py-3 text-right">
            {isEditing ? (
              <div className="flex flex-col items-end gap-1">
                {editUnits.length > 1 && (
                  <AdminSelect
                    value={editUnitId}
                    onChange={v => setEditUnitId(v)}
                    compact
                    className="w-28"
                    options={editUnits.map(u => ({
                      value: u.id,
                      label: `${u.display_label || u.unit}${u.factor !== 1 ? ` (×${u.factor})` : ''}`,
                    }))}
                  />
                )}
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  autoFocus
                  value={editQty}
                  onChange={e => setEditQty(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveEdit(p)
                    if (e.key === 'Escape') cancelEdit()
                  }}
                  className="field-xs w-20 border border-secondary-500 bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-secondary-500 text-right"
                />
                {(() => {
                  const u = editUnits.find(u => u.id === editUnitId)
                  if (!u || u.factor === 1 || u.dimension === 'count') return null
                  const base = Math.round(parseFloat(editQty || '0') * u.factor * 1000) / 1000
                  return (
                    <span className="text-xs text-foreground-muted">
                      = {base} {u.dimension === 'count' ? 'pcs' : 'base units'}
                    </span>
                  )
                })()}
              </div>
            ) : (
              (() => {
                const displayQty = parseFloat(p.inventory_quantity || '0')
                return (
                  <span
                    className={`font-medium ${displayQty === 0 ? 'text-red-500' : displayQty <= 5 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}
                  >
                    {displayQty}
                  </span>
                )
              })()
            )}
          </td>
          <td className="px-4 py-3 text-center text-foreground-secondary text-xs hidden sm:table-cell">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-secondary text-foreground-secondary font-medium whitespace-nowrap">
              {p.sell_unit_dimension === 'count' ? (
                <>
                  Pc
                  {(p.sell_unit_label || p.sell_unit) && (p.sell_unit_label || p.sell_unit) !== 'pc' ? (
                    <span className="text-foreground-muted font-normal">/ {p.sell_unit_label || p.sell_unit}</span>
                  ) : null}
                </>
              ) : (
                p.sell_unit_label || p.sell_unit || 'Pc'
              )}
              {parseFloat(p.sell_unit_factor || '1') > 1 && p.base_unit_label && (
                <span className="text-foreground-muted font-normal">
                  ({parseFloat(p.sell_unit_factor)} {p.base_unit_label})
                </span>
              )}
            </span>
          </td>
          <td className="px-4 py-3 text-right text-foreground">{formatINR(parseFloat(p.cost_price || '0'))}</td>
          <td className="px-4 py-3 text-right text-foreground-secondary text-sm">
            {parseFloat(p.gst_percentage || '0')}%
          </td>
          <td className="px-4 py-3 text-right font-semibold text-foreground">
            {formatINR(parseFloat(p.inventory_quantity || '0') * parseFloat(p.cost_price || '0'))}
          </td>
          <td className="px-4 py-3 text-right font-semibold text-foreground">
            {formatINR(parseFloat(p.inventory_quantity || '0') * parseFloat(p.selling_price || '0'))}
          </td>
          <td className="px-4 py-3 text-right align-middle">
            <div className="flex items-center justify-end gap-1 flex-nowrap">
              {isEditing ? (
                <>
                  <button
                    onClick={() => saveEdit(p)}
                    disabled={editSaving || editQty === ''}
                    title="Save"
                    aria-label="Save stock adjustment"
                    className="field-xs font-medium bg-secondary-500 hover:bg-secondary-600 text-white disabled:opacity-50 transition-colors"
                  >
                    {editSaving ? '…' : 'Save'}
                  </button>
                  <button
                    onClick={cancelEdit}
                    title="Cancel"
                    aria-label="Cancel stock adjustment"
                    className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-secondary transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href={ap(`/admin/products/${p.id}`)}
                    title="View Product"
                    aria-label="View product"
                    className="p-1.5 rounded-lg hover:bg-surface-secondary text-accent-500 hover:text-accent-600 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </Link>
                  <button
                    onClick={() => !(p.perishable || p.serialized) && startEdit(p)}
                    title={
                      p.perishable || p.serialized
                        ? 'Stock managed via batches or serials — use GRN to receive or Remove to deduct'
                        : 'Adjust stock'
                    }
                    aria-label="Adjust stock"
                    disabled={!!(p.perishable || p.serialized)}
                    className={`p-1.5 rounded-lg transition-colors ${p.perishable || p.serialized ? 'opacity-30 cursor-not-allowed text-foreground-muted' : 'hover:bg-surface-secondary text-foreground-secondary hover:text-accent-500'}`}
                    hidden={!canWrite}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                  </button>
                  <button
                    onClick={() => toggleValBatch(rowId, p.id, p.variant_id || null, p.sub_variant_id || null)}
                    title="Batch details"
                    aria-label={expandedValRows[rowId] !== undefined ? 'Collapse batch details' : 'Expand batch details'}
                    className={`p-1.5 rounded-lg hover:bg-surface-secondary transition-colors ${expandedValRows[rowId] !== undefined ? 'text-secondary-500' : 'text-foreground-secondary hover:text-secondary-500'}`}
                  >
                    {loadingBatchRow === rowId ? (
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                    ) : (
                      <svg
                        className={`w-4 h-4 transition-transform ${expandedValRows[rowId] !== undefined ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </button>
                </>
              )}
            </div>
          </td>
        </tr>
        {isEditing && (
          <tr className="bg-surface-secondary/40">
            <td colSpan={10} className="px-4 pb-3 pt-0">
              <div className="flex items-center justify-end gap-2 flex-wrap">
                <input
                  type="text"
                  placeholder="Note (optional)"
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveEdit(p)
                    if (e.key === 'Escape') cancelEdit()
                  }}
                  className="field-xs w-48 border border-border-default bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-secondary-500"
                />
                {editWarehouses.length > 0 && (
                  <AdminSelect
                    value={editWarehouseId}
                    onChange={setEditWarehouseId}
                    xs
                    className="w-40"
                    options={[
                      { value: '', label: '— warehouse —' },
                      ...editWarehouses.map(w => ({ value: w.id, label: w.name })),
                    ]}
                  />
                )}
                {editWarehouseId && (
                  <AdminSelect
                    value={editLocationId}
                    onChange={setEditLocationId}
                    xs
                    className="w-44"
                    options={[
                      { value: '', label: '— open shelf —' },
                      ...editLocations.filter(l => !l.is_open_shelf).map(l => ({ value: l.id, label: l.display_code })),
                    ]}
                  />
                )}
              </div>
            </td>
          </tr>
        )}
        {expandedValRows[rowId] !== undefined && (
          <tr className="bg-surface-secondary/30">
            <td colSpan={10} className="px-4 py-3">
              {expandedValRows[rowId]!.length === 0 ? (
                <p className="text-xs text-foreground-muted italic">
                  No batches with remaining stock for this product.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-foreground-secondary">
                      <th className="pb-1.5 text-left font-medium pr-4">Lot / Batch</th>
                      <th className="pb-1.5 text-left font-medium pr-4">Expiry</th>
                      <th className="pb-1.5 text-left font-medium pr-4 hidden sm:table-cell">Mfg Date</th>
                      <th className="pb-1.5 text-left font-medium pr-4 hidden md:table-cell">Location</th>
                      <th className="pb-1.5 text-right font-medium pr-4">Qty Remaining</th>
                      <th className="pb-1.5 text-right font-medium pr-4">Batch Value</th>
                      <th className="pb-1.5 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default/50">
                    {expandedValRows[rowId]!.map((b: any) => {
                      const d = b.expiry_date ? new Date(b.expiry_date) : null
                      const diffDays = d ? Math.floor((d.getTime() - Date.now()) / 86400000) : null
                      const expiryCls =
                        diffDays === null
                          ? 'text-foreground-muted'
                          : diffDays < 0
                            ? 'bg-red-500/10 text-red-500'
                            : diffDays <= 30
                              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                              : 'bg-green-500/10 text-green-700 dark:text-green-400'
                      const qty = parseFloat(b.quantity_remaining || '0')
                      const batchValue = qty * parseFloat(b.unit_cost || '0')
                      const serials: string[] = Array.isArray(b.serials) ? b.serials : []
                      return (
                        <tr key={b.batch_id}>
                          <td className="py-1.5 pr-4 font-mono text-foreground-secondary">{b.lot_number || '—'}</td>
                          <td className="py-1.5 pr-4">
                            {b.expiry_date ? (
                              <span className={`inline-flex px-1.5 py-0.5 rounded font-medium ${expiryCls}`}>
                                {formatDate(b.expiry_date)}
                              </span>
                            ) : (
                              <span className="text-foreground-muted">—</span>
                            )}
                          </td>
                          <td className="py-1.5 pr-4 text-foreground-secondary hidden sm:table-cell">
                            {b.manufacture_date ? formatDate(b.manufacture_date) : '—'}
                          </td>
                          <td className="py-1.5 pr-4 text-foreground-secondary hidden md:table-cell">
                            {b.location || '—'}
                          </td>
                          <td className="py-1.5 pr-4 text-right font-medium text-foreground">{qty}</td>
                          <td className="py-1.5 pr-4 text-right font-semibold text-foreground">
                            {formatINR(batchValue)}
                          </td>
                          <td className="py-1.5 text-right">
                            {canWrite && (
                              <button
                                onClick={async () => {
                                  const ok = await confirm({
                                    title: 'Remove Batch',
                                    message:
                                      qty > 0
                                        ? `This batch still has ${qty} units remaining. Are you sure you want to remove it?`
                                        : 'Remove this batch?',
                                    confirmLabel: 'Remove',
                                    variant: 'danger',
                                  })
                                  if (!ok) return
                                  const res = await fetch(`/api/admin/inventory/batches/${b.batch_id}`, {
                                    method: 'DELETE',
                                  })
                                  const json = await res.json()
                                  if (!res.ok) {
                                    showToast(json.error || 'Failed to remove batch', 'error')
                                    return
                                  }
                                  showToast('Batch removed', 'success')
                                  toggleValBatch(rowId, p.id, p.variant_id || null, p.sub_variant_id || null)
                                  setTimeout(
                                    () => toggleValBatch(rowId, p.id, p.variant_id || null, p.sub_variant_id || null),
                                    100
                                  )
                                }}
                                className="text-red-500 hover:text-red-700 text-xs px-1.5 py-0.5 rounded hover:bg-red-500/10 transition-colors"
                                title="Remove batch"
                              >
                                Remove
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {!p.perishable && parseFloat(p.inventory_quantity || '0') > 0 && (
                      <tr key="default-stock" className="border-t border-border-default/50">
                        <td className="py-1.5 pr-4 text-foreground-muted italic">Default stock</td>
                        <td className="py-1.5 pr-4 text-foreground-muted">—</td>
                        <td className="py-1.5 pr-4 text-foreground-muted hidden sm:table-cell">—</td>
                        <td className="py-1.5 pr-4 text-foreground-muted hidden md:table-cell">—</td>
                        <td className="py-1.5 pr-4 text-right font-medium text-foreground">
                          {parseFloat(p.inventory_quantity || '0')}
                        </td>
                        <td className="py-1.5 text-right font-semibold text-foreground">
                          {formatINR(parseFloat(p.inventory_quantity || '0') * parseFloat(p.cost_price || '0'))}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </td>
          </tr>
        )}
      </React.Fragment>
    )
  }

  return (
    <div className="space-y-5">
      {view === 'ledger' ? (
        <div className="space-y-4">
          <ListFilters
            entity="inventory.ledger"
            fields={LEDGER_FIELDS}
            aliases={LEDGER_ALIASES}
            search={PRODUCT_SEARCH}
            noun="Movements"
            tab="ledger"
            exportable
          />
          {(ledgerMeta?.window || ledgerMeta?.capped) && (
            <p className="text-xs text-foreground-muted">
              {ledgerMeta.window
                ? `Showing the last ${ledgerMeta.window.days} days. Pick dates to see older movements.`
                : ''}
              {ledgerMeta.capped ? ` Over ${LEDGER_COUNT_CAP.toLocaleString('en-IN')} movements match; narrow the filters to count them all.` : ''}
            </p>
          )}

          {loading ? (
            <TableSkeleton rows={6} cols={6} />
          ) : (
            <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary border-b border-border-default">
                    <tr>
                      <SortTh col={LEDGER_SORT_COLS[0]} className={SORT_TH} />
                      <SortTh col={LEDGER_SORT_COLS[1]} className={SORT_TH} />
                      <SortTh col={LEDGER_SORT_COLS[2]} className={SORT_TH} />
                      <SortTh col={LEDGER_SORT_COLS[3]} align="right" className={SORT_TH} />
                      <SortTh col={LEDGER_SORT_COLS[4]} align="right" className={SORT_TH} />
                      <SortTh col={LEDGER_SORT_COLS[5]} className={`${SORT_TH} hidden md:table-cell`} />
                      <SortTh col={LEDGER_SORT_COLS[6]} className={`${SORT_TH} hidden md:table-cell`} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {transactions.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-foreground-secondary text-sm">
                          {ledgerFilters ? 'No transactions match your filters' : ledgerMeta?.window ? `No stock movements in the last ${ledgerMeta.window.days} days` : 'No stock transactions yet'}
                        </td>
                      </tr>
                    )}
                    {ledgerGroups.map(group => {
                      const multi = group.txs.length > 1
                      const expanded = expandedGroups.has(group.refId)
                      const totalChange =
                        Math.round(group.txs.reduce((s, t) => s + Number(t.quantity_change), 0) * 1000) / 1000
                      const txType = group.txs[0].transaction_type

                      // Build per-product sub-groups within this reference group
                      type ProductSubGroup = {
                        key: string
                        productId: string
                        variantId: string | null
                        subVariantId: string | null
                        txs: StockTransaction[]
                      }
                      const productSubGroups: ProductSubGroup[] = []
                      for (const tx of group.txs) {
                        const pKey = `${tx.product_id}::${tx.variant_id || ''}::${tx.sub_variant_id || ''}`
                        const existing = productSubGroups.find(g => g.key === pKey)
                        if (existing) existing.txs.push(tx)
                        else
                          productSubGroups.push({
                            key: pKey,
                            productId: tx.product_id,
                            variantId: tx.variant_id,
                            subVariantId: tx.sub_variant_id ?? null,
                            txs: [tx],
                          })
                      }
                      const productCount = productSubGroups.length

                      const refLink =
                        group.refType === 'order' && group.linkId ? (
                          <Link
                            href={ap(`/admin/invoices/${group.linkId}/view`)}
                            className="font-mono text-accent-500 hover:underline underline-offset-2"
                          >
                            {group.refLabel || (group.linkId || group.refId).slice(0, 8) + '…'}
                          </Link>
                        ) : group.refType === 'cash_sale' && group.linkId ? (
                          <Link
                            href={ap(`/admin/cash-sale/${group.linkId}/view`)}
                            className="font-mono text-accent-500 hover:underline underline-offset-2"
                          >
                            {group.refLabel || (group.linkId || group.refId).slice(0, 8) + '…'}
                          </Link>
                        ) : group.refType === 'grn' && canFinancial ? (
                          <Link
                            href={ap(`/admin/financial?tab=grn`)}
                            className="font-mono text-accent-500 hover:underline underline-offset-2"
                          >
                            {group.refLabel || (group.linkId || group.refId).slice(0, 8) + '…'}
                          </Link>
                        ) : (
                          <span className="font-mono text-foreground-secondary">
                            {group.refType} / {(group.linkId || group.refId).slice(0, 8)}…
                          </span>
                        )

                      function fmtChange(n: number) {
                        const sign = n > 0 ? '+' : n < 0 ? '−' : ''
                        return `${sign}${Math.abs(n)}`
                      }

                      function BatchCell({ tx }: { tx: StockTransaction }) {
                        if (tx.serial_number)
                          return (
                            <div className="space-y-0.5">
                              <span className="font-mono text-foreground-secondary">{tx.serial_number}</span>
                              {tx.lot_number && (
                                <span className="block font-mono text-xs text-foreground-muted">{tx.lot_number}</span>
                              )}
                              {tx.expiry_date &&
                                (() => {
                                  const d = new Date(tx.expiry_date)
                                  const now = new Date()
                                  const diffDays = Math.floor((d.getTime() - now.getTime()) / 86400000)
                                  const cls =
                                    diffDays < 0
                                      ? 'bg-red-500/10 text-red-500'
                                      : diffDays <= 30
                                        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                        : 'bg-green-500/10 text-green-700 dark:text-green-400'
                                  return (
                                    <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>
                                      {formatDate(tx.expiry_date)}
                                    </span>
                                  )
                                })()}
                            </div>
                          )
                        if (tx.lot_number)
                          return (
                            <div className="space-y-0.5">
                              <span className="font-mono text-foreground-secondary">{tx.lot_number}</span>
                              {tx.expiry_date &&
                                (() => {
                                  const d = new Date(tx.expiry_date)
                                  const now = new Date()
                                  const diffDays = Math.floor((d.getTime() - now.getTime()) / 86400000)
                                  const cls =
                                    diffDays < 0
                                      ? 'bg-red-500/10 text-red-500'
                                      : diffDays <= 30
                                        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                        : 'bg-green-500/10 text-green-700 dark:text-green-400'
                                  return (
                                    <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>
                                      {formatDate(tx.expiry_date)}
                                    </span>
                                  )
                                })()}
                            </div>
                          )
                        return <span className="text-foreground-muted">—</span>
                      }

                      // Single-product, single-tx: flat row (no grouping chrome)
                      if (!multi) {
                        const tx = group.txs[0]
                        const chg = Number(tx.quantity_change)
                        return (
                          <tr key={tx.id} className="hover:bg-surface-secondary/50 transition-colors">
                            <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap text-xs">
                              {new Date(tx.created_at).toLocaleDateString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </td>
                            <td className="px-4 py-3 text-foreground">
                              <HoverCard
                                trigger={
                                  <Link
                                    href={ap(`/admin/products/${tx.product_id}`)}
                                    className="font-medium hover:text-accent-500 hover:underline underline-offset-2"
                                  >
                                    {tx.product_name}
                                    {tx.variant_name && (
                                      <span className="text-foreground-secondary font-normal">
                                        {' '}
                                        / {tx.variant_name}
                                        {tx.sub_variant_name ? ` / ${tx.sub_variant_name}` : ''}
                                      </span>
                                    )}
                                  </Link>
                                }
                                align="left"
                                side="bottom"
                                width="260px"
                              >
                                <div className="p-3 space-y-2">
                                  <p className="text-sm font-semibold text-foreground leading-tight">
                                    {tx.product_name}
                                  </p>
                                  {tx.variant_name && (
                                    <p className="text-xs text-foreground-secondary">
                                      {tx.variant_name}
                                      {tx.sub_variant_name ? ` / ${tx.sub_variant_name}` : ''}
                                    </p>
                                  )}
                                  {tx.product_sku && (
                                    <p className="text-xs font-mono text-foreground-muted inline-flex items-center gap-1">
                                      {tx.product_sku}
                                      <CopySku sku={tx.product_sku} />
                                    </p>
                                  )}
                                  <div className="border-t border-border-default pt-2 space-y-1.5 text-xs">
                                    <div className="flex justify-between">
                                      <span className="text-foreground-secondary">Type</span>
                                      <span
                                        className={`px-1.5 py-0.5 rounded-full font-medium ${TYPE_BADGE[tx.transaction_type] || ''}`}
                                      >
                                        {tx.transaction_type}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-foreground-secondary">Change</span>
                                      <span
                                        className={`font-mono font-semibold ${chg > 0 ? 'text-green-600 dark:text-green-400' : chg < 0 ? 'text-red-500' : 'text-foreground-secondary'}`}
                                      >
                                        {fmtChange(chg)}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-foreground-secondary">Balance after</span>
                                      <span className="font-mono font-medium text-foreground">
                                        {Number(tx.quantity_after)}
                                      </span>
                                    </div>
                                    {tx.notes && (
                                      <div className="pt-1 border-t border-border-default">
                                        <p className="text-foreground-secondary leading-snug">{tx.notes}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </HoverCard>
                              {tx.product_sku && (
                                <p className="text-xs text-foreground-muted font-mono mt-0.5 inline-flex items-center gap-1">
                                  {tx.product_sku}
                                  <CopySku sku={tx.product_sku} />
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${TYPE_BADGE[tx.transaction_type] || ''}`}
                              >
                                {tx.transaction_type}
                              </span>
                            </td>
                            <td
                              className={`px-4 py-3 text-right font-mono font-semibold ${chg > 0 ? 'text-green-600 dark:text-green-400' : chg < 0 ? 'text-red-500' : 'text-foreground-secondary'}`}
                            >
                              {fmtChange(chg)}
                              {tx.quantity_in_unit != null && tx.unit_label && (
                                <span className="block text-xs font-normal text-foreground-muted">
                                  ({Number(tx.quantity_in_unit) > 0 ? '+' : ''}
                                  {Number(tx.quantity_in_unit)} {tx.unit_label})
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-foreground font-medium">
                              {Number(tx.quantity_after)}
                            </td>
                            <td className="px-4 py-3 text-xs hidden md:table-cell">{refLink}</td>
                            <td className="px-4 py-3 text-xs hidden md:table-cell">
                              <BatchCell tx={tx} />
                            </td>
                          </tr>
                        )
                      }

                      return (
                        <React.Fragment key={`group-${group.refId}`}>
                          {/* Level-1: GRN / order header — collapses all products */}
                          <tr
                            className="bg-surface-secondary/60 hover:bg-surface-secondary cursor-pointer transition-colors select-none"
                            onClick={() => toggleGroup(group.refId)}
                          >
                            <td className="px-4 py-2.5 text-foreground-secondary whitespace-nowrap text-xs">
                              {new Date(group.date).toLocaleDateString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <svg
                                  className={`w-3.5 h-3.5 text-foreground-secondary shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                                <span className="text-sm font-medium text-foreground">
                                  {productCount === 1 ? (
                                    <>
                                      {group.txs[0].product_name}
                                      {group.txs[0].variant_name && (
                                        <span className="text-foreground-secondary font-normal">
                                          {' '}
                                          / {group.txs[0].variant_name}
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    `${productCount} products`
                                  )}
                                  <span className="ml-2 text-xs text-foreground-muted font-normal">
                                    {group.txs.length} entries
                                  </span>
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${TYPE_BADGE[txType] || ''}`}
                              >
                                {txType}
                              </span>
                            </td>
                            <td
                              className={`px-4 py-2.5 text-right font-mono font-semibold ${totalChange > 0 ? 'text-green-600 dark:text-green-400' : totalChange < 0 ? 'text-red-500' : 'text-foreground-secondary'}`}
                            >
                              {fmtChange(totalChange)}
                              <span className="block text-xs font-normal text-foreground-muted">net total</span>
                            </td>
                            <td className="px-4 py-2.5 text-right text-foreground-muted text-xs font-mono">—</td>
                            <td className="px-4 py-2.5 text-xs hidden md:table-cell">{refLink}</td>
                            <td className="px-4 py-2.5 hidden md:table-cell" />
                          </tr>

                          {/* Level-2: per-product rows (shown when level-1 expanded) */}
                          {expanded &&
                            productSubGroups.map(pg => {
                              const pgTotalChange =
                                Math.round(pg.txs.reduce((s, t) => s + Number(t.quantity_change), 0) * 1000) / 1000
                              const isSerialPg = pg.txs.length > 1 && pg.txs.every(t => t.serial_number)
                              const isBatchPg =
                                !isSerialPg && pg.txs.length > 1 && pg.txs.some(t => t.lot_number || t.batch_id)
                              const isExpandable = isSerialPg || isBatchPg
                              const serialKey = `${group.refId}::${pg.key}`
                              const serialExpanded = expandedSerialProducts.has(serialKey)
                              const repTx = pg.txs[pg.txs.length - 1] // last tx has final balance

                              return (
                                <React.Fragment key={`pg-${pg.key}`}>
                                  {/* Product row — clickable if it has serial or batch sub-rows */}
                                  <tr
                                    className={`bg-surface/40 transition-colors border-l-2 border-accent-500/30 ${isExpandable ? 'cursor-pointer hover:bg-surface-secondary/30 select-none' : 'hover:bg-surface-secondary/20'}`}
                                    onClick={isExpandable ? () => toggleSerialProduct(serialKey) : undefined}
                                  >
                                    <td className="px-4 py-2.5 text-foreground-secondary whitespace-nowrap text-xs pl-8" />
                                    <td className="px-4 py-2.5 pl-8 text-foreground">
                                      <div className="flex items-center gap-2">
                                        {isExpandable && (
                                          <svg
                                            className={`w-3 h-3 text-foreground-secondary shrink-0 transition-transform ${serialExpanded ? 'rotate-90' : ''}`}
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                          >
                                            <path
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              strokeWidth={2}
                                              d="M9 5l7 7-7 7"
                                            />
                                          </svg>
                                        )}
                                        <div>
                                          <Link
                                            href={ap(`/admin/products/${repTx.product_id}`)}
                                            className="text-sm font-medium hover:text-accent-500 hover:underline underline-offset-2"
                                            onClick={e => e.stopPropagation()}
                                          >
                                            {repTx.product_name}
                                            {repTx.variant_name && (
                                              <span className="text-foreground-secondary font-normal">
                                                {' '}
                                                / {repTx.variant_name}
                                                {repTx.sub_variant_name ? ` / ${repTx.sub_variant_name}` : ''}
                                              </span>
                                            )}
                                          </Link>
                                          {repTx.product_sku && (
                                            <p className="text-xs text-foreground-muted font-mono mt-0.5 inline-flex items-center gap-1">
                                              {repTx.product_sku}
                                              <CopySku sku={repTx.product_sku} />
                                            </p>
                                          )}
                                          {isSerialPg && (
                                            <p className="text-xs text-foreground-muted mt-0.5">
                                              {pg.txs.length} serials · {serialExpanded ? 'collapse' : 'expand'}
                                            </p>
                                          )}
                                          {isBatchPg && (
                                            <p className="text-xs text-foreground-muted mt-0.5">
                                              {pg.txs.length} batches · {serialExpanded ? 'collapse' : 'expand'}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-2.5" />
                                    <td
                                      className={`px-4 py-2.5 text-right font-mono font-semibold text-sm ${pgTotalChange > 0 ? 'text-green-600 dark:text-green-400' : pgTotalChange < 0 ? 'text-red-500' : 'text-foreground-secondary'}`}
                                    >
                                      {fmtChange(pgTotalChange)}
                                      {isExpandable && (
                                        <span className="block text-xs font-normal text-foreground-muted">
                                          net total
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono text-foreground font-medium text-sm">
                                      {isExpandable ? '—' : Number(repTx.quantity_after)}
                                    </td>
                                    <td className="px-4 py-2.5 text-xs hidden md:table-cell" />
                                    <td className="px-4 py-2.5 text-xs hidden md:table-cell">
                                      {isSerialPg ? (
                                        <span className="font-mono text-xs text-foreground-secondary">
                                          {pg.txs
                                            .slice(0, 2)
                                            .map(t => t.serial_number)
                                            .join(', ')}
                                          {pg.txs.length > 2 ? ` (+${pg.txs.length - 2} more)` : ''}
                                        </span>
                                      ) : isBatchPg ? (
                                        <span className="font-mono text-xs text-foreground-secondary">
                                          {pg.txs
                                            .slice(0, 2)
                                            .map(t => t.lot_number)
                                            .filter(Boolean)
                                            .join(', ')}
                                          {pg.txs.length > 2 ? ` (+${pg.txs.length - 2} more)` : ''}
                                        </span>
                                      ) : (
                                        <BatchCell tx={repTx} />
                                      )}
                                    </td>
                                  </tr>

                                  {/* Level-3: individual serial rows */}
                                  {isSerialPg &&
                                    serialExpanded &&
                                    pg.txs.map(tx => {
                                      const chg = Number(tx.quantity_change)
                                      return (
                                        <tr
                                          key={tx.id}
                                          className="bg-surface/20 hover:bg-surface-secondary/20 transition-colors border-l-4 border-accent-500/20"
                                        >
                                          <td className="px-4 py-2 text-foreground-secondary whitespace-nowrap text-xs pl-14" />
                                          <td className="px-4 py-2 pl-14 text-foreground">
                                            <span className="font-mono text-xs text-foreground-secondary">
                                              {tx.serial_number}
                                            </span>
                                            {tx.lot_number && (
                                              <span className="block font-mono text-xs text-foreground-muted">
                                                {tx.lot_number}
                                              </span>
                                            )}
                                          </td>
                                          <td className="px-4 py-2" />
                                          <td
                                            className={`px-4 py-2 text-right font-mono text-sm ${chg > 0 ? 'text-green-600 dark:text-green-400' : chg < 0 ? 'text-red-500' : 'text-foreground-secondary'}`}
                                          >
                                            {fmtChange(chg)}
                                          </td>
                                          <td className="px-4 py-2 text-right font-mono text-foreground text-sm">
                                            {Number(tx.quantity_after)}
                                          </td>
                                          <td className="px-4 py-2 hidden md:table-cell" />
                                          <td className="px-4 py-2 text-xs hidden md:table-cell">
                                            {tx.expiry_date &&
                                              (() => {
                                                const d = new Date(tx.expiry_date)
                                                const now = new Date()
                                                const diffDays = Math.floor((d.getTime() - now.getTime()) / 86400000)
                                                const cls =
                                                  diffDays < 0
                                                    ? 'bg-red-500/10 text-red-500'
                                                    : diffDays <= 30
                                                      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                                      : 'bg-green-500/10 text-green-700 dark:text-green-400'
                                                return (
                                                  <span
                                                    className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}
                                                  >
                                                    {formatDate(tx.expiry_date)}
                                                  </span>
                                                )
                                              })()}
                                          </td>
                                        </tr>
                                      )
                                    })}

                                  {/* Level-3: individual batch/lot rows */}
                                  {isBatchPg &&
                                    serialExpanded &&
                                    pg.txs.map(tx => {
                                      const chg = Number(tx.quantity_change)
                                      return (
                                        <tr
                                          key={tx.id}
                                          className="bg-surface/20 hover:bg-surface-secondary/20 transition-colors border-l-4 border-accent-500/20"
                                        >
                                          <td className="px-4 py-2 text-foreground-secondary whitespace-nowrap text-xs pl-14" />
                                          <td className="px-4 py-2 pl-14 text-foreground">
                                            <span className="font-mono text-xs text-foreground-secondary">
                                              {tx.lot_number || '—'}
                                            </span>
                                          </td>
                                          <td className="px-4 py-2" />
                                          <td
                                            className={`px-4 py-2 text-right font-mono text-sm ${chg > 0 ? 'text-green-600 dark:text-green-400' : chg < 0 ? 'text-red-500' : 'text-foreground-secondary'}`}
                                          >
                                            {fmtChange(chg)}
                                          </td>
                                          <td className="px-4 py-2 text-right font-mono text-foreground text-sm">
                                            {Number(tx.quantity_after)}
                                          </td>
                                          <td className="px-4 py-2 hidden md:table-cell" />
                                          <td className="px-4 py-2 text-xs hidden md:table-cell">
                                            {tx.expiry_date &&
                                              (() => {
                                                const d = new Date(tx.expiry_date)
                                                const now = new Date()
                                                const diffDays = Math.floor((d.getTime() - now.getTime()) / 86400000)
                                                const cls =
                                                  diffDays < 0
                                                    ? 'bg-red-500/10 text-red-500'
                                                    : diffDays <= 30
                                                      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                                      : 'bg-green-500/10 text-green-700 dark:text-green-400'
                                                return (
                                                  <span
                                                    className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}
                                                  >
                                                    {formatDate(tx.expiry_date)}
                                                  </span>
                                                )
                                              })()}
                                          </td>
                                        </tr>
                                      )
                                    })}
                                </React.Fragment>
                              )
                            })}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 pb-4">
                <InfiniteFooter shown={transactions.length} control={txList} noun="transactions" />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <ListFilters
            entity="inventory.valuation"
            fields={VALUATION_FIELDS}
            aliases={VALUATION_ALIASES}
            search={PRODUCT_SEARCH}
            noun="Products"
            tab="valuation"
            exportable
          />

          {loading ? (
            <TableSkeleton rows={6} cols={6} />
          ) : valuation ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryCard
                  label="Stock Value (ex-GST)"
                  value={formatINR(valuation.totalValue || 0)}
                  accent
                  sub={`${valTotal} SKUs`}
                />
                <SummaryCard
                  label="Stock Value (incl. GST)"
                  value={formatINR(valuation.totalValueInclGst || 0)}
                  accent
                  sub={valFilters ? 'matching the filters' : 'all products'}
                />
                <SummaryCard label="Total SKUs" value={String(valTotal)} sub={valFilters ? 'matching the filters' : 'across all products'} />
                <SummaryCard
                  label="In Stock"
                  value={String(
                    valuation.inStockCount ?? allValRows.filter(p => parseFloat(p.inventory_quantity || '0') > 0).length
                  )}
                  sub={valFilters ? 'matching the filters' : 'across all products'}
                />
              </div>
              <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
                <div className="overflow-x-auto">
                  {/* Below md: price, GST % and incl.-GST value are hidden so quantity, value and Adjust fit on a phone. */}
                  <table className="w-full text-sm max-md:[&>*>tr>:nth-child(6)]:hidden max-md:[&>*>tr>:nth-child(7)]:hidden max-md:[&>*>tr>:nth-child(9)]:hidden">
                    <thead className="bg-surface-secondary border-b border-border-default">
                      <tr>
                        <SortTh col={VAL_SORT_COLS[0]} className={SORT_TH} />
                        <SortTh col={VAL_SORT_COLS[1]} className={`${SORT_TH} hidden sm:table-cell`} />
                        <SortTh col={VAL_SORT_COLS[2]} className={`${SORT_TH} hidden md:table-cell`} />
                        <SortTh col={VAL_SORT_COLS[3]} align="right" className={`${SORT_TH} w-[110px]`} />
                        <SortTh col={VAL_SORT_COLS[4]} align="center" className={`${SORT_TH} hidden sm:table-cell`} />
                        <SortTh col={VAL_SORT_COLS[5]} align="right" className={SORT_TH} />
                        <SortTh col={VAL_SORT_COLS[6]} align="right" className={SORT_TH} />
                        <SortTh col={VAL_SORT_COLS[7]} align="right" className={SORT_TH} />
                        <SortTh col={VAL_SORT_COLS[8]} align="right" className={SORT_TH} />
                        <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide w-[130px]">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-default">
                      {valTree.length === 0 && (
                        <tr>
                          <td colSpan={10} className="py-12 text-center text-foreground-secondary text-sm">
                            {valFilters ? 'No products match these filters' : 'No products in stock'}
                          </td>
                        </tr>
                      )}
                      {valTree.map(prod => {
                        const productExpanded = expandedValProducts.has(prod.productId)
                        const chevron = (expanded: boolean) => (
                          <svg
                            className={`w-4 h-4 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        )

                        if (prod.simpleLeaf && prod.variants.length === 0) {
                          const p = prod.simpleLeaf
                          const firstCell = (
                            <HoverCard
                              trigger={
                                <Link
                                  href={ap(`/admin/products/${p.id}`)}
                                  className="hover:text-accent-500 hover:underline underline-offset-2"
                                >
                                  {p.name}
                                </Link>
                              }
                              align="left"
                              side="bottom"
                              width="260px"
                            >
                              <div className="p-3 space-y-2">
                                <p className="text-sm font-semibold text-foreground leading-tight">{p.name}</p>
                                {(p.row_sku || p.sku) && (
                                  <p className="text-xs font-mono text-foreground-muted">{p.row_sku || p.sku}</p>
                                )}
                                <div className="border-t border-border-default pt-2 space-y-1.5 text-xs">
                                  <div className="flex justify-between">
                                    <span className="text-foreground-secondary">Stock</span>
                                    <span className="font-semibold text-foreground">
                                      {parseFloat(p.inventory_quantity || '0')}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-foreground-secondary">Price ex-GST</span>
                                    <span className="font-medium text-foreground">
                                      {formatINR(parseFloat(p.cost_price || '0'))}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-foreground-secondary">Stock Value</span>
                                    <span className="font-semibold text-foreground">
                                      {formatINR(
                                        parseFloat(p.inventory_quantity || '0') * parseFloat(p.cost_price || '0')
                                      )}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </HoverCard>
                          )
                          return renderValLeaf(p, firstCell, '—')
                        }

                        return (
                          <React.Fragment key={prod.productId}>
                            <tr className="hover:bg-surface-secondary/50 transition-colors">
                              <td className="px-4 py-3 font-medium text-foreground">
                                <button
                                  onClick={() => toggleValProduct(prod.productId)}
                                  className="flex items-center gap-1.5 text-left hover:text-secondary-500 transition-colors"
                                >
                                  {chevron(productExpanded)}
                                  <HoverCard
                                    trigger={
                                      <Link
                                        href={ap(`/admin/products/${prod.head.id}`)}
                                        onClick={e => e.stopPropagation()}
                                        className="hover:text-accent-500 hover:underline underline-offset-2"
                                      >
                                        {prod.head.name}
                                      </Link>
                                    }
                                    align="left"
                                    side="bottom"
                                    width="260px"
                                  >
                                    <div className="p-3 space-y-2">
                                      <p className="text-sm font-semibold text-foreground leading-tight">
                                        {prod.head.name}
                                      </p>
                                      {(prod.head.row_sku || prod.head.sku) && (
                                        <p className="text-xs font-mono text-foreground-muted">
                                          {prod.head.row_sku || prod.head.sku}
                                        </p>
                                      )}
                                      <div className="border-t border-border-default pt-2 space-y-1.5 text-xs">
                                        <div className="flex justify-between">
                                          <span className="text-foreground-secondary">Stock</span>
                                          <span className="font-semibold text-foreground">{prod.stock}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-foreground-secondary">Stock Value</span>
                                          <span className="font-semibold text-foreground">
                                            {formatINR(prod.valueEx)}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  </HoverCard>
                                </button>
                              </td>
                              <td className="px-4 py-3 text-foreground-secondary hidden sm:table-cell">—</td>
                              <td className="px-4 py-3 font-mono text-xs text-foreground-secondary hidden md:table-cell">
                                <span className="inline-flex items-center gap-1">
                                  {prod.head.row_sku || prod.head.sku || '—'}
                                  {(prod.head.row_sku || prod.head.sku) && (
                                    <CopySku sku={prod.head.row_sku || prod.head.sku} />
                                  )}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right font-medium text-foreground">{prod.stock}</td>
                              <td className="px-4 py-3 text-center text-foreground-muted text-xs hidden sm:table-cell">
                                —
                              </td>
                              <td className="px-4 py-3 text-right text-foreground-muted">—</td>
                              <td className="px-4 py-3 text-right text-foreground-muted text-sm">—</td>
                              <td className="px-4 py-3 text-right font-semibold text-foreground">
                                {formatINR(prod.valueEx)}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-foreground">
                                {formatINR(prod.valueIncl)}
                              </td>
                              <td className="px-4 py-3 text-right text-foreground-muted">—</td>
                            </tr>
                            {productExpanded &&
                              prod.variants.map(variant => {
                                const variantExpanded = expandedValVariants.has(variant.variantId)
                                const hasSubs = variant.subVariants.length > 0

                                if (!hasSubs && variant.leaf) {
                                  const p = variant.leaf
                                  const firstCell = (
                                    <span className="pl-8 flex items-center gap-1.5">
                                      <span className="text-foreground-secondary">{p.variant_name || '—'}</span>
                                    </span>
                                  )
                                  return renderValLeaf(p, firstCell, p.variant_name || '—')
                                }

                                const vHead = variant.leaf || variant.subVariants[0]
                                return (
                                  <React.Fragment key={variant.variantId}>
                                    <tr className="hover:bg-surface-secondary/50 transition-colors">
                                      <td className="px-4 py-3 font-medium text-foreground">
                                        <button
                                          onClick={() => toggleValVariant(variant.variantId)}
                                          className="pl-8 flex items-center gap-1.5 text-left hover:text-secondary-500 transition-colors"
                                        >
                                          {chevron(variantExpanded)}
                                          <span className="text-foreground-secondary">{vHead.variant_name || '—'}</span>
                                        </button>
                                      </td>
                                      <td className="px-4 py-3 text-foreground-secondary hidden sm:table-cell">
                                        {vHead.variant_name || '—'}
                                      </td>
                                      <td className="px-4 py-3 font-mono text-xs text-foreground-secondary hidden md:table-cell">
                                        <span className="inline-flex items-center gap-1">
                                          {vHead.row_sku || vHead.sku || '—'}
                                          {(vHead.row_sku || vHead.sku) && <CopySku sku={vHead.row_sku || vHead.sku} />}
                                        </span>
                                      </td>
                                      <td className="px-4 py-3 text-right font-medium text-foreground">
                                        {variant.stock}
                                      </td>
                                      <td className="px-4 py-3 text-center text-foreground-muted text-xs hidden sm:table-cell">
                                        —
                                      </td>
                                      <td className="px-4 py-3 text-right text-foreground-muted">—</td>
                                      <td className="px-4 py-3 text-right text-foreground-muted text-sm">—</td>
                                      <td className="px-4 py-3 text-right font-semibold text-foreground">
                                        {formatINR(variant.valueEx)}
                                      </td>
                                      <td className="px-4 py-3 text-right font-semibold text-foreground">
                                        {formatINR(variant.valueIncl)}
                                      </td>
                                      <td className="px-4 py-3 text-right text-foreground-muted">—</td>
                                    </tr>
                                    {variantExpanded &&
                                      variant.subVariants.map(sv => {
                                        const firstCell = (
                                          <span className="pl-12 flex items-center gap-1.5">
                                            <span className="text-foreground-secondary">
                                              {sv.sub_variant_name || '—'}
                                            </span>
                                          </span>
                                        )
                                        const variantCell = sv.variant_name
                                          ? sv.sub_variant_name
                                            ? `${sv.variant_name} / ${sv.sub_variant_name}`
                                            : sv.variant_name
                                          : sv.sub_variant_name || '—'
                                        return renderValLeaf(sv, firstCell, variantCell)
                                      })}
                                  </React.Fragment>
                                )
                              })}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 pb-4">
                  <InfiniteFooter shown={allValRows.length} control={valList} noun="SKUs" />
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}

type Tab = 'overview' | StockView

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'ledger', label: 'Stock ledger' },
  { id: 'valuation', label: 'Valuation' },
]

// Old links without a tab land on the list their filters belong to.
function initialTab(sp: URLSearchParams): Tab {
  const t = sp.get('tab')
  if (TABS.some(x => x.id === t)) return t as Tab
  if (['ledger_search', 'ledger_from', 'ledger_to'].some(k => sp.get(k))) return 'ledger'
  if (['val_search', 'val_category', 'val_brand', 'val_stock'].some(k => sp.get(k))) return 'valuation'
  return 'overview'
}

export default function InventoryClient() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(() => initialTab(new URLSearchParams(searchParams.toString())))

  // Switching tabs keeps the filters (search and from / to are shared by the tabs that have them).
  function handleTabChange(key: Tab) {
    setTab(key)
    const p = new URLSearchParams(searchParams.toString())
    p.set('tab', key)
    p.delete('page')
    router.push(`${ap('/admin/inventory')}?${p}`, { scroll: false })
  }

  return (
    <div className="space-y-5">
      <Tabs tabs={TABS} value={tab} onChange={handleTabChange} />
      <div>
        {tab === 'overview' && <InventoryOverviewTab />}
        {tab !== 'overview' && <StockTab key={tab} view={tab} />}
      </div>
    </div>
  )
}
