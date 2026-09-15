'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import AdminSelect from '@/components/admin/AdminSelect'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import { applyDiscount, mrpDiscountPct, lineItemInclGst } from '@/lib/pricing'
import { round2 } from '@/lib/gst'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { useToast } from '@/contexts/ToastContext'
import { productLabel, variantLabel } from '@/lib/product-label'
import { useBarcodeScanner } from '@/components/admin/useBarcodeScanner'
import CopySku from '@/components/ui/CopySku'

export interface SellUnit {
  unit: string
  display_label: string
  factor: number
  dimension: string
  is_base: boolean
  min_qty: number
  max_qty: number | null
  qty_step: number
}

export interface LineItem {
  id: string
  product_id: string | null
  product_name: string
  product_sku: string
  variant_id: string | null
  sub_variant_id: string | null
  variant_name: string
  sub_variant_name?: string
  hsn_code: string
  gst_rate: string
  quantity: string | number
  unit: string
  buy_unit: string | null
  buy_mode: string | null
  sell_unit_factor: number
  sell_unit_dimension: string | null
  available_units: SellUnit[]
  selected_unit_key: string
  unit_price: string | number
  price_ex_gst?: number
  discount_pct: number
  mrp: number
  inventory_quantity: number | null
  serialized?: boolean
  perishable?: boolean
}

interface Suggestion {
  id: string
  product_id: string
  variant_id: string | null
  sub_variant_id: string | null
  name: string
  variant_name: string | null
  sub_variant_name?: string | null
  sku: string
  base_price: number | null
  price_ex_gst: number | null
  mrp: number | null
  gst_percentage: number | null
  hsn_code: string | null
  inventory_quantity: number | null
  discount_pct?: number | null
  serialized?: boolean | null
}

interface Category {
  id: string
  name: string
}

type SearchMode = 'name' | 'sku' | 'category' | 'scanner'


export function newLineItem(): LineItem {
  return {
    id: Math.random().toString(36).slice(2),
    product_id: null, product_name: '', product_sku: '',
    variant_id: null, sub_variant_id: null, variant_name: '',
    hsn_code: '', gst_rate: '18', quantity: 1, unit: 'PCS',
    buy_unit: null, buy_mode: null, sell_unit_factor: 1, sell_unit_dimension: null,
    available_units: [], selected_unit_key: '',
    unit_price: 0, discount_pct: 0, mrp: 0, inventory_quantity: null,
  }
}

// Build a seed LineItem from a resolved product suggestion. Units are left empty on
// purpose — LineItemsSection's mount backfill effect hydrates available_units from the
// product_id. Used for deep-link preseed (scan → quick action) so a scanned product
// lands as the first line item. Mirrors the internal buildLineItemFromSuggestion.
export function seedLineItemFromSuggestion(s: {
  product_id: string; variant_id?: string | null; sub_variant_id?: string | null
  name: string; variant_name?: string | null; sub_variant_name?: string | null; sku: string
  base_price?: number | null; price_ex_gst?: number | null; mrp?: number | null
  gst_percentage?: number | null; hsn_code?: string | null
  inventory_quantity?: number | null; discount_pct?: number | null; serialized?: boolean | null
}): LineItem {
  const mrp = Number(s.mrp) || 0
  const basePrice = Number(s.base_price) || 0
  const priceExGst = Number(s.price_ex_gst) || 0
  const gstRate = Number(s.gst_percentage ?? 18)
  const discount_pct = s.discount_pct != null ? Number(s.discount_pct) : mrpDiscountPct(mrp, basePrice)
  const unit_price = mrp > 0 ? mrp : round2(basePrice * (1 + gstRate / 100))
  return {
    ...newLineItem(),
    product_id: s.product_id,
    product_name: productLabel({ product_name: s.name, variant_name: s.variant_name, sub_variant_name: s.sub_variant_name }, ' — '),
    product_sku: s.sku,
    variant_id: s.variant_id ?? null,
    sub_variant_id: s.sub_variant_id ?? null,
    variant_name: s.variant_name || '',
    sub_variant_name: s.sub_variant_name || '',
    hsn_code: s.hsn_code || '',
    gst_rate: String(Math.round(gstRate)),
    unit_price,
    price_ex_gst: priceExGst || undefined,
    discount_pct,
    mrp,
    inventory_quantity: s.inventory_quantity ?? null,
    serialized: s.serialized ?? false,
  }
}

// Resolve a product/variant id to a suggestion via the shared scan resolver, then seed
// a LineItem. Returns null if the product can't be resolved. Reused by deep-link preseed.
export async function fetchSeedLineItem(productId: string, variantId?: string | null): Promise<LineItem | null> {
  try {
    const res = await fetch('/api/admin/scan/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ code: variantId || productId }),
    })
    const data = await res.json().catch(() => ({}))
    const item = data?.item
    if (!item || !item.product_id) return null
    return seedLineItemFromSuggestion(item)
  } catch {
    return null
  }
}

async function fetchProductUnits(productId: string, variantId?: string | null): Promise<SellUnit[]> {
  const toUnits = (rows: any[]) => rows.map((u: any) => ({
    unit: u.unit,
    display_label: u.display_label || u.unit,
    factor: Number(u.factor) || 1,
    dimension: u.dimension || 'count',
    is_base: !!u.is_base,
    min_qty: Number(u.min_qty) || 1,
    max_qty: u.max_qty != null ? Number(u.max_qty) : null,
    qty_step: Number(u.qty_step) || 1,
  }))
  try {
    // Always fetch product-level units (includes base + extra count units)
    const res = await fetch(`/api/admin/products/${productId}/units`, { credentials: 'include' })
    if (!res.ok) return []
    const productUnits = toUnits((await res.json()).units || [])

    if (variantId) {
      // Fetch variant-specific units; if present, use variant's base unit
      // but keep product-level non-base (extra) units (box, dozen, etc.)
      const vres = await fetch(
        `/api/admin/products/${productId}/units?variant_id=${variantId}`,
        { credentials: 'include' }
      )
      if (vres.ok) {
        const vunits = toUnits((await vres.json()).units || [])
        if (vunits.length) {
          const variantBase = vunits.find(u => u.is_base) ?? vunits[0]
          const productExtras = productUnits.filter(u => !u.is_base)
          return [variantBase, ...productExtras]
        }
      }
    }

    return productUnits
  } catch {
    return []
  }
}

function getSelectedUnit(it: LineItem): SellUnit | null {
  if (!it.available_units.length) return null
  if (it.selected_unit_key) {
    return it.available_units.find(u => u.unit === it.selected_unit_key) ?? it.available_units[0]
  }
  return it.available_units[0]
}

function calcLine(it: LineItem, gstEnabled: boolean = true) {
  const qty = Number(it.quantity) || 0
  const mrpIncl = Number(it.unit_price) || 0
  const gstRate = Number(it.gst_rate) || 0
  const discPct = Number(it.discount_pct) || 0
  const mrpEx = mrpIncl / (1 + gstRate / 100)
  // For count-dimension units, MRP is per piece; multiply qty by factor
  const su = getSelectedUnit(it)
  const effectiveQty = (su && su.dimension === 'count' && su.factor > 1)
    ? qty * su.factor
    : qty
  // GST off ⇒ charge the ex-GST value (strip the entered GST, add none back).
  return lineItemInclGst(effectiveQty, mrpEx, discPct, gstEnabled ? gstRate : 0)
}

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function decodeLineItemId(encoded: string) {
  const parts = encoded.split('|')
  const [product_id, variant_id_raw, base_price_raw, gst_raw, hsn_raw, mrp_raw, inv_raw, sub_variant_id_raw, discount_pct_raw, variant_name_raw, sub_variant_name_raw] = parts
  const mrp = parseFloat(mrp_raw) || 0
  const basePrice = parseFloat(base_price_raw) || 0
  // unit_price = MRP incl. GST (anchor); fall back to base_price if no MRP
  const unit_price = mrp > 0 ? mrp : basePrice
  const discount_pct = discount_pct_raw !== undefined && discount_pct_raw !== ''
    ? parseFloat(discount_pct_raw)
    : 0
  return {
    product_id,
    variant_id: variant_id_raw || null,
    sub_variant_id: sub_variant_id_raw || null,
    unit_price,
    discount_pct,
    mrp,
    gst_percentage: gst_raw ? String(Math.round(parseFloat(gst_raw))) : '18',
    hsn_code: hsn_raw || '',
    inventory_quantity: inv_raw !== undefined && inv_raw !== '' ? parseFloat(inv_raw) : null,
    variant_name: variant_name_raw || '',
    sub_variant_name: sub_variant_name_raw || '',
  }
}

const inputCls = 'w-full px-2 py-1.5 rounded border border-border-default bg-surface-secondary text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-secondary-500 dark:focus:ring-secondary-400 disabled:opacity-60 disabled:cursor-not-allowed'
const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'

export interface ScannedSerial {
  serial_number: string
  serial_id: string | null
  product_id: string | null
  variant_id: string | null
  sub_variant_id: string | null
}

interface LineItemsSectionProps {
  items: LineItem[]
  onChange: (items: LineItem[]) => void
  onStockBadgeClick?: (item: LineItem) => void
  assignedBatchLabels?: Record<string, string>
  /** Fired when a SERIALIZED unit is added via a serial scan, so the parent can
   *  auto-record that serial as this line's assignment (keyed by the surviving
   *  line id). Lets a serial-scanned line skip the "assign serials" prompt. */
  onSerialScanned?: (lineId: string, serial: ScannedSerial) => void
  /** Fired when a line's quantity drops below its assigned-serial count, so the
   *  parent can trim the extra assignments. `keep` = new (lower) quantity. */
  onQuantityReduced?: (lineId: string, keep: number) => void
  /** Renders serial/batch assignment INLINE under a line, in an expandable panel.
   *  Only the invoice and cash-sale forms pass this; everywhere else the modal
   *  stays. Return null for a line that needs no assignment. */
  renderLineAssignment?: (item: LineItem) => React.ReactNode
  /** Short status for the collapsed row, e.g. "10 of 10 serials". */
  lineAssignmentSummary?: (item: LineItem) => { label: string; complete: boolean } | null
}

export default function LineItemsSection({ items, onChange, onStockBadgeClick, assignedBatchLabels, onSerialScanned, onQuantityReduced, renderLineAssignment, lineAssignmentSummary }: LineItemsSectionProps) {
  const { showToast } = useToast()
  const [scanEnabled, setScanEnabled] = useState(true)
  // Per-line Scanner mode input text, keyed by line id. Predictive-search fields
  // debounce/re-render and drop characters mid-burst; a plain per-line scan field
  // (data-scan-box, ignored by the global wedge hook) doesn't.
  const [scanInputs, setScanInputs] = useState<Record<string, string>>({})
  const [expandedAssignments, setExpandedAssignments] = useState<Set<string>>(new Set())
  // Serials already scanned onto this line-item set, mapped serial_number → the
  // line id it landed on. Used to REJECT re-scanning the same physical unit, and
  // pruned when a line is removed / its product cleared so the serial frees up.
  const scannedSerialsRef = useRef<Map<string, string>>(new Map())
  // The serial identity captured by the most recent resolveScanToSuggestion() call
  // when it matched a serial (null otherwise). Read by the scan sinks to report the
  // assignment to the parent via onSerialScanned, keyed to the surviving line.
  const lastScannedSerialRef = useRef<ScannedSerial | null>(null)
  const gstEnabled = useStoreConfig().flags.gstEnabled
  const [searchModes, setSearchModes] = useState<Record<string, SearchMode>>({})
  const [nameInputs, setNameInputs] = useState<Record<string, string>>({})
  const [skuInputs, setSkuInputs] = useState<Record<string, string>>({})
  const [categoryIds, setCategoryIds] = useState<Record<string, string>>({})

  const [categories, setCategories] = useState<Category[]>([])

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerItemId, setPickerItemId] = useState<string | null>(null)
  const [pickerCatId, setPickerCatId] = useState('')
  const [pickerProducts, setPickerProducts] = useState<Suggestion[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')

  useEffect(() => {
    fetch('/api/categories', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setCategories(d.categories || d || []))
      .catch(() => {})
  }, [])

  // Backfill units for items loaded from an existing order (available_units is [])
  useEffect(() => {
    const needsUnits = items.filter(it => it.product_id && it.available_units.length === 0)
    if (!needsUnits.length) return
    let cancelled = false
    Promise.all(
      needsUnits.map(it =>
        fetchProductUnits(it.product_id!, it.variant_id).then(units => ({ it, units }))
      )
    ).then(results => {
      if (cancelled) return
      onChange(items.map(it => {
        const found = results.find(r => r.it.id === it.id)
        if (!found || !found.units.length) return it
        const u = found.units[0]
        const normalizedQty = u.dimension === 'count'
          ? String(Math.round(parseFloat(String(it.quantity)) || 1))
          : String(it.quantity)
        return {
          ...it,
          available_units: found.units,
          selected_unit_key: it.selected_unit_key || u.unit,
          buy_unit: it.buy_unit || u.unit,
          buy_mode: u.dimension === 'count' ? 'count' : u.dimension,
          sell_unit_factor: u.factor,
          sell_unit_dimension: u.dimension,
          unit: u.display_label.toUpperCase(),
          quantity: normalizedQty,
        }
      }))
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map(i => i.id).join(',')])

  function openPicker(itemId: string, catId: string) {
    setPickerItemId(itemId)
    setPickerCatId(catId)
    setPickerSearch('')
    setPickerProducts([])
    setPickerOpen(true)
    loadPickerProducts(catId, '')
  }

  async function loadPickerProducts(catId: string, q: string) {
    if (!catId) return
    setPickerLoading(true)
    try {
      const params = new URLSearchParams({ limit: '10000', category_id: catId })
      if (q.trim()) params.set('q', q.trim())
      const res = await fetch(`/api/admin/labels/products?${params}`, { credentials: 'include' })
      const data = await res.json()
      const raw: any[] = data.products || []
      setPickerProducts(raw.map(p => ({
        ...p,
        sub_variant_id: p.id?.startsWith('subvariant:') ? p.id.slice('subvariant:'.length) : null,
      })))
    } catch { setPickerProducts([]) }
    finally { setPickerLoading(false) }
  }

  function buildLineItemFromSuggestion(it: LineItem, s: Suggestion): LineItem {
    const mrp = Number(s.mrp) || 0
    const basePrice = Number(s.base_price) || 0
    const priceExGst = Number(s.price_ex_gst) || 0
    const gstRate = Number(s.gst_percentage ?? 18)
    const discount_pct = s.discount_pct != null
      ? Number(s.discount_pct)
      : mrpDiscountPct(mrp, basePrice)
    // unit_price = MRP incl. GST (anchor); discount_pct is applied on top
    // Fall back to base_price if mrp is not set
    const unit_price = mrp > 0 ? mrp : round2(basePrice * (1 + gstRate / 100))
    return {
      ...it,
      product_id: s.product_id,
      product_name: productLabel({ product_name: s.name, variant_name: s.variant_name, sub_variant_name: s.sub_variant_name }, ' — '),
      product_sku: s.sku,
      variant_id: s.variant_id,
      sub_variant_id: s.sub_variant_id,
      variant_name: s.variant_name || '',
      sub_variant_name: s.sub_variant_name || '',
      hsn_code: s.hsn_code || '',
      gst_rate: String(Math.round(gstRate)),
      unit_price,
      price_ex_gst: priceExGst || undefined,
      discount_pct,
      mrp,
      inventory_quantity: s.inventory_quantity ?? null,
      serialized: s.serialized ?? false,
      buy_unit: it.buy_unit,
      buy_mode: it.buy_mode,
      sell_unit_factor: it.sell_unit_factor,
      sell_unit_dimension: it.sell_unit_dimension,
      available_units: it.available_units,
    }
  }

  async function populateUnits(populated: LineItem): Promise<LineItem> {
    if (!populated.product_id) return populated
    const units = await fetchProductUnits(populated.product_id, populated.variant_id)
    if (!units.length) return { ...populated, available_units: [], selected_unit_key: '', buy_unit: null }
    const defaultUnit = units[0]
    // Normalize quantity to the unit's grid so the <input min/step> doesn't reject
    // it. Grid model matches the server (selling-unit.ts): a positive multiple of
    // qty_step, with min_qty as a floor. Snap the inherited quantity onto that grid.
    const step = defaultUnit.qty_step > 0 ? defaultUnit.qty_step : 1
    const floor = defaultUnit.min_qty || 0
    const minOnGrid = Math.max(step, Math.ceil((floor - 1e-9) / step) * step)
    const rawQty = parseFloat(String(populated.quantity)) || minOnGrid
    let qty = Math.round((Math.round(rawQty / step) * step) * 1e9) / 1e9
    if (qty < minOnGrid) qty = minOnGrid
    if (defaultUnit.max_qty != null && qty > defaultUnit.max_qty) qty = defaultUnit.max_qty
    return {
      ...populated,
      available_units: units,
      selected_unit_key: defaultUnit.unit,
      buy_unit: defaultUnit.unit,
      buy_mode: defaultUnit.dimension === 'count' ? 'count' : defaultUnit.dimension,
      sell_unit_factor: defaultUnit.factor,
      sell_unit_dimension: defaultUnit.dimension,
      unit: defaultUnit.display_label.toUpperCase(),
      quantity: String(qty),
    }
  }

  function mergeOrReplaceItem(targetItemId: string, populated: LineItem): LineItem[] {
    if (!populated.product_id) {
      return items.map(it => it.id === targetItemId ? populated : it)
    }
    const dupIdx = items.findIndex(it =>
      it.id !== targetItemId &&
      it.product_id === populated.product_id &&
      (it.variant_id || null) === (populated.variant_id || null) &&
      (it.sub_variant_id || null) === (populated.sub_variant_id || null)
    )
    if (dupIdx === -1) {
      return items.map(it => it.id === targetItemId ? populated : it)
    }
    const addQty = Number(populated.quantity) || 1
    return items
      .map((it, i) => {
        if (i === dupIdx) {
          const existing = Number(it.quantity) || 0
          return { ...it, quantity: String(existing + addQty) }
        }
        return it
      })
      .filter(it => it.id !== targetItemId)
  }

  async function applyPickerProduct(s: Suggestion) {
    if (!pickerItemId) return
    const target = items.find(it => it.id === pickerItemId)
    if (!target) return
    const populated = buildLineItemFromSuggestion(target, s)
    const withUnits = await populateUnits(populated)
    onChange(mergeOrReplaceItem(pickerItemId, withUnits))
    setPickerOpen(false)
    setPickerItemId(null)
  }

  // ── Barcode scanning (hardware keyboard-wedge) ──────────────────────────────
  // A scan resolves to a product/variant and is added as a new line (or increments
  // an existing matching line). Uses a fresh blank line as the merge target so
  // mergeOrReplaceItem's dedupe logic collapses repeat scans into a qty bump.

  // Resolve a scanned code (SKU / barcode / GTIN / LOT / serial) to a common
  // Suggestion shape. Returns null (and toasts) if unresolved or a duplicate serial.
  // Shared by the always-on keyboard-wedge (handleScan → append) and the per-line
  // Scanner mode (fillScanLine → fill that line).
  async function resolveScanToSuggestion(code: string): Promise<Suggestion | null> {
    const res = await fetch('/api/admin/scan/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ code }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.kind === 'not_found' || (!data.item && !data.serial)) {
      showToast(`No product found for "${code}"`, 'error')
      return null
    }
    // Reset the captured serial each resolve; set only on a serial match below.
    lastScannedSerialRef.current = null

    // Resolve to a common { product_id, variant_id, sub_variant_id, name, sku,
    // pricing } shape regardless of whether it matched a SKU/barcode/GTIN (item),
    // a LOT/batch (item + sub_variant_id), or a SERIAL (serial payload).
    let src: any
    if (data.kind === 'serial') {
      // Only in-stock units can be sold. A serial already 'sold' (or 'reserved'
      // for another order) is not available — reject before it reaches a line.
      const status = String(data.serial.status || '')
      if (status && status !== 'in_stock') {
        const label = status === 'sold' ? 'already sold' : status === 'reserved' ? 'reserved' : status
        showToast(`Serial ${data.serial.serial_number || code} is ${label}`, 'error')
        return null
      }
      // Serial units are UNIQUE — a given serial may be added only once. A repeat
      // scan of the SAME serial is rejected (it's the same physical unit). Scanning
      // a DIFFERENT serial of the same product still increments that product's line.
      const sn = String(data.serial.serial_number || code)
      if (scannedSerialsRef.current.has(sn)) {
        showToast(`Serial ${sn} already scanned`, 'error')
        return null
      }
      // NOTE: recorded into scannedSerialsRef by the scan sink (handleScan /
      // fillScanLine) once the surviving line id is known, so it can be freed when
      // that line is removed / cleared.
      // Capture the serial identity so the scan sinks can report it to the parent
      // (onSerialScanned) as this line's auto-assignment.
      lastScannedSerialRef.current = {
        serial_number: sn,
        serial_id: data.serial.serial_id ?? null,
        product_id: data.serial.product_id ?? null,
        variant_id: data.serial.variant_id ?? null,
        sub_variant_id: data.serial.sub_variant_id ?? null,
      }
      // The resolve route now attaches the full priced product/variant `item` for a
      // serial too, so pricing/GST/HSN/discount populate exactly like a Name/SKU
      // scan. Fall back to the serial payload's identity fields if item is absent.
      const it = data.item ?? {}
      src = {
        id: it.id ?? (data.serial.variant_id || data.serial.product_id),
        product_id: data.serial.product_id,
        variant_id: data.serial.variant_id ?? null,
        sub_variant_id: data.serial.sub_variant_id ?? null,
        name: it.name ?? data.serial.product_name,
        variant_name: it.variant_name ?? data.serial.variant_name ?? null,
        sku: it.sku ?? data.serial.variant_sku ?? data.serial.product_sku,
        base_price: it.base_price ?? null, price_ex_gst: it.price_ex_gst ?? null,
        mrp: it.mrp ?? null, gst_percentage: it.gst_percentage ?? null,
        hsn_code: it.hsn_code ?? null, inventory_quantity: it.inventory_quantity ?? null,
        discount_pct: it.discount_pct ?? null,
        serialized: true,
      }
    } else {
      // product / variant / batch(lot) — all carry `item`. Batch includes
      // sub_variant_id + lot info; a lot re-scan increments qty (many units per lot).
      const it = data.item
      src = {
        id: it.id, product_id: it.product_id,
        variant_id: it.variant_id ?? null, sub_variant_id: it.sub_variant_id ?? null,
        name: it.name, variant_name: it.variant_name ?? null,
        sku: it.sku, base_price: it.base_price ?? null, price_ex_gst: it.price_ex_gst ?? null,
        mrp: it.mrp ?? null, gst_percentage: it.gst_percentage ?? null,
        hsn_code: it.hsn_code ?? null, inventory_quantity: it.inventory_quantity ?? null,
        discount_pct: it.discount_pct ?? null, serialized: it.serialized ?? null,
      }
      if (data.kind === 'batch') showToast(`Lot ${data.item.lot_number || code} → ${it.name}`, 'info')
    }

    return {
      id: src.id, product_id: src.product_id,
      variant_id: src.variant_id, sub_variant_id: src.sub_variant_id,
      name: src.name, variant_name: src.variant_name,
      sku: src.sku, base_price: src.base_price ?? null, price_ex_gst: src.price_ex_gst ?? null,
      mrp: src.mrp ?? null, gst_percentage: src.gst_percentage ?? null,
      hsn_code: src.hsn_code ?? null, inventory_quantity: src.inventory_quantity ?? null,
      discount_pct: src.discount_pct ?? null, serialized: src.serialized ?? null,
    }
  }

  async function handleScan(code: string) {
    try {
      const suggestion = await resolveScanToSuggestion(code)
      if (!suggestion) return
      // Build the line with its selling-unit defaults, then merge — increments an
      // existing matching line by ONE selling unit (respects the unit factor via
      // populated.quantity), or adds a new line. Same path manual add uses.
      const blank = newLineItem()
      const populated = buildLineItemFromSuggestion(blank, suggestion)
      const withUnits = await populateUnits(populated)
      const addQty = Number(withUnits.quantity) || 1
      const dupIdx = items.findIndex(x =>
        x.product_id === withUnits.product_id &&
        (x.variant_id || null) === (withUnits.variant_id || null) &&
        (x.sub_variant_id || null) === (withUnits.sub_variant_id || null)
      )
      const survivingLineId = dupIdx === -1 ? withUnits.id : items[dupIdx].id
      if (dupIdx === -1) {
        onChange([...items, withUnits])
      } else {
        onChange(items.map((x, i) =>
          i === dupIdx ? { ...x, quantity: String((Number(x.quantity) || 0) + addQty) } : x
        ))
      }
      // Auto-assign the scanned serial to the surviving line (parent dedupes).
      const scanned = lastScannedSerialRef.current
      if (scanned) {
        scannedSerialsRef.current.set(scanned.serial_number, survivingLineId)
        if (onSerialScanned) onSerialScanned(survivingLineId, scanned)
      }
      showToast(`Added ${withUnits.product_name}`, 'success')
    } catch {
      showToast('Scan lookup failed', 'error')
    }
  }

  // captureInInputs: true — operators scan while a form field (customer name, qty,
  // etc.) is focused, so the burst must be captured regardless of focus. The hook
  // swallows the fast burst chars so the scanned code isn't also typed into the
  // focused field; slow manual typing is unaffected.
  useBarcodeScanner({ onScan: handleScan, enabled: scanEnabled, captureInInputs: true })

  // Per-line Scanner mode: resolve the scanned code and FILL that specific line
  // (item.id) — same manual-add path as the Name/SKU typeahead onSelect handlers.
  // mergeOrReplaceItem fills the target row, or (if a matching row already exists)
  // increments that row by one selling unit and drops the now-empty target. Then
  // auto-append a fresh blank line in Scanner mode so scanning continues hands-free.
  async function fillScanLine(itemId: string, code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    const target = items.find(it => it.id === itemId)
    if (!target) return
    try {
      const suggestion = await resolveScanToSuggestion(trimmed)
      if (!suggestion) {
        // Not found (or duplicate serial) — clear this line's field so the operator
        // can immediately re-scan without manually clearing the bad value.
        setScanInputs(p => { const n = { ...p }; delete n[itemId]; return n })
        return
      }
      const populated = buildLineItemFromSuggestion(target, suggestion)
      const withUnits = await populateUnits(populated)
      // Determine the surviving line id BEFORE merge: if a matching line already
      // exists (other than this target), mergeOrReplaceItem bumps THAT line's qty
      // and drops the target — so the serial belongs to the pre-existing line.
      const dupLine = items.find(it =>
        it.id !== itemId &&
        it.product_id === withUnits.product_id &&
        (it.variant_id || null) === (withUnits.variant_id || null) &&
        (it.sub_variant_id || null) === (withUnits.sub_variant_id || null)
      )
      const survivingLineId = dupLine ? dupLine.id : itemId
      const merged = mergeOrReplaceItem(itemId, withUnits)
      const blank = newLineItem()
      onChange([...merged, blank])
      setSearchModes(p => ({ ...p, [blank.id]: 'scanner' }))
      setScanInputs(p => { const n = { ...p }; delete n[itemId]; return n })
      // Auto-assign the scanned serial to the surviving line (parent dedupes).
      const scanned = lastScannedSerialRef.current
      if (scanned) {
        scannedSerialsRef.current.set(scanned.serial_number, survivingLineId)
        if (onSerialScanned) onSerialScanned(survivingLineId, scanned)
      }
      showToast(`Added ${withUnits.product_name}`, 'success')
    } catch {
      showToast('Scan lookup failed', 'error')
    }
  }

  // Free every scanned-serial dedupe entry that belongs to a line, so those physical
  // units can be scanned again after the line is removed or its product cleared.
  function freeScannedSerialsForLine(lineId: string) {
    for (const [sn, lid] of scannedSerialsRef.current) {
      if (lid === lineId) scannedSerialsRef.current.delete(sn)
    }
  }

  function clearProduct(itemId: string) {
    freeScannedSerialsForLine(itemId)
    onChange(items.map(it => it.id !== itemId ? it : {
      ...it, product_id: null, product_name: '', product_sku: '',
      variant_id: null, variant_name: '', hsn_code: '', gst_rate: '18',
      unit_price: 0, discount_pct: 0, mrp: 0, inventory_quantity: null,
      buy_unit: null, buy_mode: null, sell_unit_factor: 1, sell_unit_dimension: null,
      available_units: [], selected_unit_key: '',
    }))
    setNameInputs(p => { const n = { ...p }; delete n[itemId]; return n })
    setSkuInputs(p => { const n = { ...p }; delete n[itemId]; return n })
    setScanInputs(p => { const n = { ...p }; delete n[itemId]; return n })
    setSearchModes(p => { const n = { ...p }; delete n[itemId]; return n })
  }

  function updateItem(id: string, field: keyof LineItem, value: string) {
    if (field === 'quantity') {
      // If quantity drops, tell the parent so it can trim any serial assignments
      // beyond the new count (a serialized line needs exactly `quantity` serials).
      const prev = items.find(it => it.id === id)
      const prevQty = prev ? Number(prev.quantity) || 0 : 0
      const nextQty = Number(value) || 0
      if (nextQty < prevQty) {
        if (onQuantityReduced) onQuantityReduced(id, nextQty)
        // Free the dedupe entries for the trimmed tail (insertion order mirrors scan
        // order) so those physical units can be scanned again.
        const forLine = [...scannedSerialsRef.current.entries()].filter(([, lid]) => lid === id)
        for (const [sn] of forLine.slice(Math.max(0, nextQty))) scannedSerialsRef.current.delete(sn)
      }
    }
    onChange(items.map(it => it.id === id ? { ...it, [field]: value } : it))
  }

  const rawTotal = items.reduce((s, it) => s + calcLine(it, gstEnabled), 0)
  const taxableValue = items.reduce((s, it) => {
    const qty = Number(it.quantity) || 0
    const gstRate = Number(it.gst_rate) || 0
    const mrpEx = (Number(it.unit_price) || 0) / (1 + gstRate / 100)
    const su = getSelectedUnit(it)
    const effectiveQty = (su && su.dimension === 'count' && su.factor > 1)
      ? qty * su.factor
      : qty
    return s + lineItemInclGst(effectiveQty, mrpEx, Number(it.discount_pct) || 0, 0)
  }, 0)
  const cgst = gstEnabled ? items.reduce((s, it) => {
    const qty = Number(it.quantity) || 0
    const gstRate = Number(it.gst_rate) || 0
    const mrpEx = (Number(it.unit_price) || 0) / (1 + gstRate / 100)
    const su = getSelectedUnit(it)
    const effectiveQty = (su && su.dimension === 'count' && su.factor > 1)
      ? qty * su.factor
      : qty
    const exAmt = lineItemInclGst(effectiveQty, mrpEx, Number(it.discount_pct) || 0, 0)
    return s + exAmt * gstRate / 200
  }, 0) : 0
  const sgst = cgst
  const total = round2(rawTotal)
  const roundOff = round2(total - rawTotal)

  return (
    <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">Line Items</h2>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setScanEnabled(v => !v)}
            title={scanEnabled ? 'Barcode scanning on — scan a product to add it' : 'Barcode scanning off'}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-lg border transition-colors ${scanEnabled ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default text-foreground-muted hover:bg-surface-secondary'}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h1m3 0h1m3 0v12M4 18h1m11-12h1M8 18h1m7-12v12m3-12h1v12h-1" />
            </svg>
            {scanEnabled ? 'Scan: on' : 'Scan: off'}
          </button>
          <button type="button" onClick={() => onChange([...items, newLineItem()])}
            className="flex items-center gap-1 text-xs text-secondary-500 dark:text-secondary-300 font-semibold hover:text-secondary-600 dark:hover:text-secondary-200 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Item
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {items.map((item, idx) => {
          const mode = searchModes[item.id] ?? 'scanner'
          const hasProduct = !!item.product_name

          return (
            <div key={item.id} className="border border-border-default rounded-lg p-3 space-y-3 bg-surface-elevated">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Item {idx + 1}</span>
                {items.length > 1 && (
                  <button type="button" onClick={() => { freeScannedSerialsForLine(item.id); onChange(items.filter(i => i.id !== item.id)) }}
                    className="text-xs text-red-500 hover:text-red-600 font-medium">Remove</button>
                )}
              </div>

              <div className="relative">
                {hasProduct ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-secondary rounded-lg border border-border-default">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{item.product_name}</p>
                      {variantLabel({ variant_name: item.variant_name, sub_variant_name: item.sub_variant_name }) && (
                        <p className="text-xs text-foreground-secondary truncate">
                          {variantLabel({ variant_name: item.variant_name, sub_variant_name: item.sub_variant_name })}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5">
                        {item.product_sku && <p className="text-xs text-foreground-muted font-mono"><span className="inline-flex items-center gap-1">{item.product_sku}<CopySku sku={item.product_sku} /></span></p>}
                        {assignedBatchLabels?.[item.id] ? (
                          <button type="button" onClick={() => onStockBadgeClick?.(item)} className="text-xs font-medium px-1.5 py-0.5 rounded-full cursor-pointer hover:opacity-80 transition-opacity bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                            Batch: {assignedBatchLabels[item.id]}
                          </button>
                        ) : item.inventory_quantity !== null && (() => {
                          const su = getSelectedUnit(item)
                          const factor = (su && su.dimension === 'count' && su.factor > 1) ? su.factor : 1
                          const stockInUnits = factor > 1 ? Math.floor(item.inventory_quantity / factor) : item.inventory_quantity
                          const unitLabel = factor > 1 ? (su?.display_label ?? item.buy_unit ?? 'units') : 'pcs'
                          const isOut = stockInUnits === 0
                          const isLow = !isOut && stockInUnits <= 5
                          return onStockBadgeClick && !isOut ? (
                            <button type="button" onClick={() => onStockBadgeClick(item)} className={`text-xs font-medium px-1.5 py-0.5 rounded-full cursor-pointer hover:opacity-80 transition-opacity ${
                              isLow
                                ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                                : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            }`}>
                              {`Stock: ${stockInUnits} ${unitLabel}`}
                            </button>
                          ) : (
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                              isOut
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                : isLow
                                ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                                : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            }`}>
                              {isOut ? 'Out of stock' : `Stock: ${stockInUnits} ${unitLabel}`}
                            </span>
                          )
                        })()}
                      </div>
                    </div>
                    <button type="button"
                      onClick={() => clearProduct(item.id)}
                      className="shrink-0 text-xs text-secondary-500 dark:text-secondary-300 font-semibold hover:text-secondary-600 dark:hover:text-secondary-200 transition-colors">
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-1 mb-2 p-1 bg-surface-secondary rounded-lg w-fit">
                      {(['name', 'sku', 'category', 'scanner'] as SearchMode[]).map(m => (
                        <button key={m} type="button"
                          onClick={() => {
                            setSearchModes(p => ({ ...p, [item.id]: m }))
                            setNameInputs(p => { const n = { ...p }; delete n[item.id]; return n })
                            setSkuInputs(p => { const n = { ...p }; delete n[item.id]; return n })
                            setScanInputs(p => { const n = { ...p }; delete n[item.id]; return n })
                          }}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${mode === m ? 'bg-secondary-500 dark:bg-secondary-400 text-white dark:text-secondary-900 shadow-sm' : 'text-foreground-secondary hover:text-foreground'}`}>
                          {m === 'name' ? 'Name' : m === 'sku' ? 'SKU' : m === 'category' ? 'Category' : 'Scanner'}
                        </button>
                      ))}
                    </div>

                    {mode === 'name' && (
                      <AdminTypeahead
                        type="line_items"
                        value={nameInputs[item.id] ?? ''}
                        onChange={v => setNameInputs(p => ({ ...p, [item.id]: v }))}
                        onSelect={async s => {
                          const d = decodeLineItemId(s.id)
                          const populated: LineItem = {
                            ...item,
                            product_id: d.product_id,
                            product_name: s.label,
                            product_sku: s.sublabel?.split(' · ')[0] ?? '',
                            variant_id: d.variant_id,
                            sub_variant_id: d.sub_variant_id,
                            variant_name: d.variant_name,
                            sub_variant_name: d.sub_variant_name,
                            hsn_code: d.hsn_code,
                            gst_rate: d.gst_percentage,
                            unit_price: d.unit_price,
                            discount_pct: d.discount_pct,
                            mrp: d.mrp,
                            inventory_quantity: d.inventory_quantity,
                            buy_unit: item.buy_unit,
                            buy_mode: item.buy_mode,
                            sell_unit_factor: item.sell_unit_factor,
                            sell_unit_dimension: item.sell_unit_dimension,
                            available_units: item.available_units,
                          }
                          const withUnits = await populateUnits(populated)
                          onChange(mergeOrReplaceItem(item.id, withUnits))
                        }}
                        inputClassName={inputCls}
                        placeholder="Search by product name..."
                      />
                    )}

                    {mode === 'sku' && (
                      <AdminTypeahead
                        type="line_items"
                        value={skuInputs[item.id] ?? ''}
                        onChange={v => setSkuInputs(p => ({ ...p, [item.id]: v }))}
                        onSelect={async s => {
                          const d = decodeLineItemId(s.id)
                          const sku = s.sublabel?.split(' · ')[0] ?? ''
                          const populated: LineItem = {
                            ...item,
                            product_id: d.product_id,
                            product_name: s.label,
                            product_sku: sku,
                            variant_id: d.variant_id,
                            sub_variant_id: d.sub_variant_id,
                            variant_name: d.variant_name,
                            sub_variant_name: d.sub_variant_name,
                            hsn_code: d.hsn_code,
                            gst_rate: d.gst_percentage,
                            unit_price: d.unit_price,
                            discount_pct: d.discount_pct,
                            mrp: d.mrp,
                            inventory_quantity: d.inventory_quantity,
                            buy_unit: item.buy_unit,
                            buy_mode: item.buy_mode,
                            sell_unit_factor: item.sell_unit_factor,
                            sell_unit_dimension: item.sell_unit_dimension,
                            available_units: item.available_units,
                          }
                          const withUnits = await populateUnits(populated)
                          onChange(mergeOrReplaceItem(item.id, withUnits))
                        }}
                        inputClassName={inputCls + ' font-mono'}
                        placeholder="e.g. JFS-1234"
                      />
                    )}

                    {mode === 'category' && (
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <AdminSelect
                            value={categoryIds[item.id] ?? ''}
                            onChange={v => setCategoryIds(p => ({ ...p, [item.id]: v }))}
                            placeholder="— Select category —"
                            options={categories.map(c => ({ value: c.id, label: c.name }))}
                          />
                        </div>
                        <button type="button"
                          disabled={!categoryIds[item.id]}
                          onClick={() => openPicker(item.id, categoryIds[item.id] ?? '')}
                          className="px-3 py-1.5 bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap">
                          Select Product
                        </button>
                      </div>
                    )}

                    {mode === 'scanner' && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-accent-500 bg-accent-50 dark:bg-accent-900/20">
                        <svg className="w-4 h-4 shrink-0 text-accent-600 dark:text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h1m3 0h1m3 0v12M4 18h1m11-12h1M8 18h1m7-12v12m3-12h1v12h-1" />
                        </svg>
                        <input
                          data-scan-box
                          type="text"
                          value={scanInputs[item.id] ?? ''}
                          onChange={e => setScanInputs(p => ({ ...p, [item.id]: e.target.value }))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              e.stopPropagation()
                              fillScanLine(item.id, scanInputs[item.id] ?? '')
                            }
                          }}
                          className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-foreground-muted"
                          placeholder="Scan a SKU / lot / serial…"
                          autoComplete="off"
                          spellCheck={false}
                          autoFocus
                        />
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <div>
                  <label className={labelCls}>HSN Code</label>
                  <input type="text" value={item.hsn_code} onChange={e => updateItem(item.id, 'hsn_code', e.target.value)}
                    className={inputCls + ' font-mono'} placeholder="9999" />
                </div>
                {gstEnabled && (
                <div>
                  <label className={labelCls}>GST %</label>
                  <AdminSelect
                    sm
                    value={item.gst_rate}
                    onChange={v => updateItem(item.id, 'gst_rate', v)}
                    options={[
                      { value: '0', label: '0%' }, { value: '5', label: '5%' },
                      { value: '12', label: '12%' }, { value: '18', label: '18%' },
                      { value: '28', label: '28%' },
                    ]}
                  />
                </div>
                )}
                <div>
                  <label className={labelCls}>Quantity <span className="text-red-500">*</span></label>
                  {(() => {
                    const su = getSelectedUnit(item)
                    // Grid model MUST match the server (src/lib/selling-unit.ts):
                    // a valid quantity is a positive multiple of qty_step (offset 0),
                    // with min_qty a FLOOR — not a grid offset. (An earlier bug used
                    // `min + n·step`, so a stored min_qty like 0.001 made the browser
                    // reject clean integers such as 2 → "nearest valid 1.001, 2.001".)
                    const qStep = su ? (su.qty_step > 0 ? su.qty_step : 1) : 1
                    const qFloor = su ? su.min_qty : 0
                    // Smallest step-multiple that is still ≥ the min_qty floor.
                    const qMin = Math.max(qStep, Math.ceil((qFloor - 1e-9) / qStep) * qStep)
                    // UI only caps at product_units.max_qty — stock is checked at finalization
                    const qMax: number | undefined = su?.max_qty != null ? su.max_qty : undefined
                    const clamp = (v: number) => {
                      // Snap to the nearest positive step-multiple, then apply floor/cap.
                      let r = Math.round((Math.round(v / qStep) * qStep) * 1e9) / 1e9
                      if (r < qMin) r = qMin
                      if (qMax != null && r > qMax) r = qMax
                      return r
                    }
                    const cur = parseFloat(String(item.quantity)) || qMin
                    return (
                      <div>
                        {su ? (
                          <div className="flex items-center gap-0.5 w-full px-1 py-1.5 rounded border border-border-default bg-surface-secondary">
                            <button type="button"
                              onClick={() => updateItem(item.id, 'quantity', String(clamp(cur - qStep)))}
                              disabled={cur <= qMin}
                              className="px-1 text-foreground-secondary hover:text-foreground disabled:opacity-30 transition-colors">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                            </button>
                            <input
                              type="number"
                              min={qMin}
                              step={qStep}
                              max={qMax}
                              value={item.quantity}
                              onChange={e => updateItem(item.id, 'quantity', e.target.value)}
                              onBlur={e => {
                                let v = parseFloat(e.target.value)
                                updateItem(item.id, 'quantity', String(clamp(isNaN(v) ? qMin : v)))
                              }}
                              required
                              className="flex-1 min-w-0 text-center text-sm font-medium bg-transparent border-none outline-none text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button type="button"
                              onClick={() => updateItem(item.id, 'quantity', String(clamp(cur + qStep)))}
                              disabled={qMax != null && cur >= qMax}
                              className="px-1 text-foreground-secondary hover:text-foreground disabled:opacity-30 transition-colors">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                            </button>
                          </div>
                        ) : (
                          <input
                            type="number"
                            min={qMin}
                            step={qStep}
                            max={qMax}
                            value={item.quantity}
                            onChange={e => updateItem(item.id, 'quantity', e.target.value)}
                            onBlur={e => {
                              let v = parseFloat(e.target.value)
                              if (isNaN(v) || v < qMin) v = qMin
                              if (qMax != null && v > qMax) v = qMax
                              updateItem(item.id, 'quantity', String(v))
                            }}
                            required
                            className={inputCls}
                          />
                        )}
                        {su && su.factor > 1 && Number(item.quantity) > 0 && (
                          <p className="text-[10px] text-foreground-secondary mt-0.5">
                            {Math.round(Number(item.quantity) * su.factor)} pcs total
                            {item.inventory_quantity != null && (
                              <span className={Number(item.quantity) * su.factor > item.inventory_quantity ? ' text-amber-500 font-medium' : ''}>
                                {' · '}stock: {item.inventory_quantity} pcs
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    )
                  })()}
                </div>
                <div>
                  <label className={labelCls}>Unit</label>
                  {(() => {
                    const countUnits = item.available_units.filter(u => u.dimension === 'count')
                    if (countUnits.length > 1) {
                      const selectedKey = item.selected_unit_key || countUnits[0].unit
                      return (
                        <AdminSelect
                          sm
                          value={selectedKey}
                          onChange={v => {
                            const picked = item.available_units.find(u => u.unit === v)
                            if (!picked) return
                            onChange(items.map(it => it.id !== item.id ? it : {
                              ...it,
                              selected_unit_key: picked.unit,
                              buy_unit: picked.unit,
                              sell_unit_factor: picked.factor,
                              unit: picked.display_label.toUpperCase(),
                            }))
                          }}
                          options={countUnits.map(u => ({
                            value: u.unit,
                            label: u.display_label + (u.factor > 1 ? ` (${u.factor} pcs)` : ''),
                          }))}
                        />
                      )
                    }
                    return (
                      <div className={inputCls + ' flex items-center justify-center font-medium text-center select-none bg-surface-secondary text-foreground'}>
                        {item.buy_unit ? (getSelectedUnit(item)?.display_label ?? item.buy_unit) : (item.unit || '—')}
                      </div>
                    )
                  })()}
                </div>
                <div>
                  <label className={labelCls}>{gstEnabled ? 'MRP (incl. GST)' : 'MRP'} <span className="text-red-500">*</span></label>
                  <input type="number" min="0" step="0.01" value={item.unit_price}
                    onChange={e => updateItem(item.id, 'unit_price', e.target.value)} required
                    className={inputCls} placeholder="0.00" />
                </div>
                <div>
                  <label className={labelCls}>Discount %</label>
                  <input type="number" min="0" max="100" step="any" value={item.discount_pct}
                    onChange={e => updateItem(item.id, 'discount_pct', e.target.value)}
                    className={inputCls} placeholder="0" />
                </div>
              </div>

              {Number(item.unit_price) > 0 && (
                <div className="flex items-center justify-between text-xs text-foreground-secondary">
                  {Number(item.discount_pct) > 0 ? (
                    <span>
                      MRP: <span className="line-through text-foreground-muted">₹{fmt(Number(item.unit_price))}</span>
                      {' · '}Disc: <span className="text-green-600 dark:text-green-400 font-medium">{item.discount_pct}%</span>
                      {' · '}Net: <span className="font-medium text-foreground">₹{fmt(calcLine({ ...item, quantity: 1 }, gstEnabled))}</span>
                    </span>
                  ) : <span />}
                  <span>Line total: <span className="font-semibold text-foreground">₹{fmt(calcLine(item, gstEnabled))}</span></span>
                </div>
              )}

              {hasProduct && renderLineAssignment && (() => {
                const panel = renderLineAssignment(item)
                if (!panel) return null
                const summary = lineAssignmentSummary?.(item) ?? null
                const open = expandedAssignments.has(item.id)
                return (
                  <div className="rounded-lg border border-border-default bg-surface-secondary/40">
                    <button
                      type="button"
                      onClick={() => setExpandedAssignments(prev => {
                        const next = new Set(prev)
                        if (next.has(item.id)) next.delete(item.id); else next.add(item.id)
                        return next
                      })}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
                    >
                      <span className="text-xs font-medium text-foreground-secondary">
                        {summary?.label ?? 'Assign serials / batch'}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        {summary && (
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                            summary.complete
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                          }`}>
                            {summary.complete ? 'Ready' : 'Needed'}
                          </span>
                        )}
                        <span className={`text-foreground-muted transition-transform ${open ? 'rotate-180' : ''}`}>⌄</span>
                      </span>
                    </button>
                    {open && <div className="px-3 pb-3">{panel}</div>}
                  </div>
                )
              })()}
            </div>
          )
        })}
      </div>

      {items.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([...items, newLineItem()])}
          className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-border-default text-xs font-semibold text-secondary-500 dark:text-secondary-300 hover:bg-surface-secondary hover:border-secondary-400 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Item
        </button>
      )}

      <div className="flex justify-end border-t border-border-default pt-3 mt-1">
        <div className="text-right space-y-1 min-w-[220px]">
          <div className="flex justify-between gap-8 text-xs text-foreground-secondary">
            <span>{gstEnabled ? 'Taxable Value' : 'Subtotal'}</span>
            <span>₹{fmt(taxableValue)}</span>
          </div>
          {gstEnabled && (
            <div className="flex justify-between gap-8 text-xs text-foreground-secondary">
              <span>CGST</span>
              <span>₹{fmt(cgst)}</span>
            </div>
          )}
          {gstEnabled && (
            <div className="flex justify-between gap-8 text-xs text-foreground-secondary">
              <span>SGST</span>
              <span>₹{fmt(sgst)}</span>
            </div>
          )}
          {Math.abs(roundOff) >= 0.005 && (
            <div className="flex justify-between gap-8 text-xs text-foreground-secondary">
              <span>Round Off</span>
              <span>{roundOff >= 0 ? '+' : ''}₹{fmt(roundOff)}</span>
            </div>
          )}
          <div className="flex justify-between gap-8 border-t border-border-default pt-1 mt-1">
            <span className="text-xs text-foreground-secondary font-medium">{gstEnabled ? 'Total (incl. GST)' : 'Total'}</span>
            <span className="text-xl font-bold text-foreground">₹{fmt(total)}</span>
          </div>
        </div>
      </div>

      {pickerOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-surface-elevated border border-border-default rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-default shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Select Product</h3>
                <p className="text-xs text-foreground-muted mt-0.5">
                  {categories.find(c => c.id === pickerCatId)?.name || 'All products'}
                </p>
              </div>
              <button type="button" onClick={() => setPickerOpen(false)}
                className="p-1.5 text-foreground-secondary hover:text-foreground transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-4 py-3 border-b border-border-default shrink-0">
              <input
                type="text"
                value={pickerSearch}
                onChange={e => { setPickerSearch(e.target.value); loadPickerProducts(pickerCatId, e.target.value) }}
                className={inputCls}
                placeholder="Filter by name or SKU…"
                autoFocus
              />
            </div>

            <div className="overflow-y-auto flex-1">
              {pickerLoading ? (
                <div className="p-8 text-center text-foreground-muted text-sm">Loading…</div>
              ) : pickerProducts.length === 0 ? (
                <div className="p-8 text-center text-foreground-muted text-sm">No products found in this category.</div>
              ) : (() => {
                const groups: { productId: string; name: string; items: Suggestion[] }[] = []
                for (const p of pickerProducts) {
                  const g = groups.find(g => g.productId === p.product_id)
                  if (g) g.items.push(p)
                  else groups.push({ productId: p.product_id, name: p.name, items: [p] })
                }
                return (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-secondary">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">Product / Variant</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">SKU</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-foreground-secondary">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map(g => (
                        <>
                          {g.items.length > 1 && (
                            <tr key={`${g.productId}-header`}>
                              <td colSpan={3} className="px-4 pt-2.5 pb-1 text-xs font-semibold text-foreground-muted uppercase tracking-wider bg-surface-secondary">
                                {g.name}
                              </td>
                            </tr>
                          )}
                          {g.items.map(s => (
                            <tr key={s.id}
                              onClick={() => applyPickerProduct(s)}
                              className="border-t border-border-default hover:bg-surface-secondary cursor-pointer transition-colors">
                              <td className="px-4 py-2.5">
                                {g.items.length > 1 ? (
                                  <span className="text-foreground pl-2">{s.variant_name || s.name}</span>
                                ) : (
                                  <span className="font-medium text-foreground">{s.name}</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-xs text-foreground-muted"><span className="inline-flex items-center gap-1">{s.sku}{s.sku && <CopySku sku={s.sku} />}</span></td>
                              <td className="px-4 py-2.5 text-right text-foreground font-medium">
                                {s.base_price != null ? `₹${s.base_price}` : '—'}
                              </td>
                            </tr>
                          ))}
                        </>
                      ))}
                    </tbody>
                  </table>
                )
              })()}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
