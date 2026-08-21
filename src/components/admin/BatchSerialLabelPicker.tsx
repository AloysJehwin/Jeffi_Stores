'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { useBarcodeScanner } from '@/components/admin/useBarcodeScanner'
import { LABEL_SIZES, type LabelSize, type LabelSpec } from '@/lib/label-sizes'
import { BatchSerialPreview } from '@/components/admin/label-preview'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import CopySku from '@/components/ui/CopySku'

type Mode = 'batch' | 'serial'

interface BatchRow {
  id: string
  lot_number: string | null
  expiry_date: string | null
  manufacture_date: string | null
  quantity_remaining: number
  product_name: string
  sku: string
  variant_name: string | null
}

interface SerialRow {
  serial_number: string
  batch_id: string | null
  lot_number: string | null
}

interface SerialProductRow {
  product_id: string
  variant_id: string | null
  product_name: string
  sku: string
  variant_name: string | null
  in_stock_count: number
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return String(d).slice(0, 10)
}

export interface BatchSerialLabelPickerProps {
  mode: Mode
  /** Size specs; defaults to the full LABEL_SIZES list. */
  labelSizes?: LabelSpec[]
  /** Pre-select these batch ids on mount (batch mode). */
  preselectedBatchIds?: string[]
  /** Pre-select these serials on mount (serial mode). */
  preselectedSerials?: string[]
  /** Load one specific product's batches/serials and hide the search box. */
  lockProduct?: { product_id: string; variant_id?: string | null; name?: string }
  /** Tighter layout for use inside a modal. */
  compact?: boolean
}

export default function BatchSerialLabelPicker({
  mode,
  labelSizes = LABEL_SIZES,
  preselectedBatchIds,
  preselectedSerials,
  lockProduct,
  compact = false,
}: BatchSerialLabelPickerProps) {
  const { showToast } = useToast()
  const printableSizes = labelSizes.filter(s => s.size !== 'shelf-card')
  const [selectedSize, setSelectedSize] = useState<LabelSize>('40x60')
  const [outputMode, setOutputMode] = useState<'thermal' | 'sheet'>('thermal')
  const [copies, setCopies] = useState(1)
  const [downloading, setDownloading] = useState(false)

  // ── Batch mode state ──
  const [query, setQuery] = useState('')
  const [batches, setBatches] = useState<BatchRow[]>([])
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>(preselectedBatchIds ?? [])
  // Per-batch label count (defaults to the batch's quantity_remaining).
  const [batchCounts, setBatchCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)

  // ── Serial mode state ──
  const [serials, setSerials] = useState<SerialRow[]>([])
  const [selectedSerials, setSelectedSerials] = useState<string[]>(preselectedSerials ?? [])
  const [resolvedProduct, setResolvedProduct] = useState<{ id: string; name: string } | null>(
    lockProduct ? { id: lockProduct.product_id, name: lockProduct.name || '' } : null
  )
  // Serialized-product picker: admin searches/selects a product, then its serials load.
  const [serialProducts, setSerialProducts] = useState<SerialProductRow[]>([])
  const [serialProductQuery, setSerialProductQuery] = useState('')
  const [serialProductsLoading, setSerialProductsLoading] = useState(false)
  const [chosenProduct, setChosenProduct] = useState<SerialProductRow | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeSize = printableSizes.find(s => s.size === selectedSize) ?? printableSizes[0]

  // Default a batch's count to its remaining qty the first time it appears.
  const ensureBatchCount = useCallback((b: BatchRow) => {
    setBatchCounts(prev => (prev[b.id] != null ? prev : { ...prev, [b.id]: Math.max(1, Math.round(Number(b.quantity_remaining) || 1)) }))
  }, [])

  // Batch search (debounced). When lockProduct is set, load that product's batches.
  useEffect(() => {
    if (mode !== 'batch') return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const run = () => {
      setLoading(true)
      const url = lockProduct
        ? `/api/admin/labels/batch/list?product_id=${encodeURIComponent(lockProduct.product_id)}`
        : `/api/admin/labels/batch/list?q=${encodeURIComponent(query)}`
      fetch(url, { credentials: 'include' })
        .then(r => r.json())
        .then(d => {
          const rows: BatchRow[] = d.batches || []
          setBatches(rows)
          // Seed default counts for every listed batch.
          setBatchCounts(prev => {
            const next = { ...prev }
            for (const b of rows) if (next[b.id] == null) next[b.id] = Math.max(1, Math.round(Number(b.quantity_remaining) || 1))
            return next
          })
        })
        .catch(() => setBatches([]))
        .finally(() => setLoading(false))
    }
    if (lockProduct) run()
    else debounceRef.current = setTimeout(run, 250)
  }, [query, mode, lockProduct])

  // Serial lookup: resolve a scanned/entered product code, then load its in-stock serials.
  const loadSerialsForProduct = useCallback(async (code: string) => {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      const res = await fetch('/api/admin/scan/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ code: trimmed }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.kind === 'serial') {
        setSelectedSerials(prev => prev.includes(data.serial.serial_number) ? prev : [...prev, data.serial.serial_number])
        setResolvedProduct({ id: data.serial.product_id, name: data.serial.product_name })
        showToast(`Added serial ${data.serial.serial_number}`, 'success')
        return
      }
      if (!data.item) { showToast(`Not found: ${trimmed}`, 'error'); return }
      const pid = data.item.product_id
      setResolvedProduct({ id: pid, name: data.item.name })
      const sres = await fetch(`/api/admin/inventory/serials/available?product_id=${pid}${data.item.variant_id ? `&variant_id=${data.item.variant_id}` : ''}`, { credentials: 'include' })
      const sdata = await sres.json().catch(() => ({}))
      setSerials(sdata.serials || [])
      if (!(sdata.serials || []).length) showToast('No in-stock serials for this product', 'info')
    } catch { showToast('Lookup failed', 'error') }
  }, [showToast])

  // Serial mode with lockProduct: load that product's serials on mount.
  useEffect(() => {
    if (mode !== 'serial' || !lockProduct) return
    const load = async () => {
      const sres = await fetch(`/api/admin/inventory/serials/available?product_id=${lockProduct.product_id}${lockProduct.variant_id ? `&variant_id=${lockProduct.variant_id}` : ''}`, { credentials: 'include' })
      const sdata = await sres.json().catch(() => ({}))
      setSerials(sdata.serials || [])
    }
    load()
  }, [mode, lockProduct])

  // Serial mode (not locked): list serialized products for the picker, debounced.
  useEffect(() => {
    if (mode !== 'serial' || lockProduct || chosenProduct) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSerialProductsLoading(true)
      fetch(`/api/admin/labels/serial/products?q=${encodeURIComponent(serialProductQuery)}`, { credentials: 'include' })
        .then(r => r.json())
        .then(d => setSerialProducts(d.products || []))
        .catch(() => setSerialProducts([]))
        .finally(() => setSerialProductsLoading(false))
    }, 250)
  }, [mode, lockProduct, chosenProduct, serialProductQuery])

  // Admin picks a serialized product → load its in-stock serials.
  const chooseSerialProduct = useCallback(async (p: SerialProductRow) => {
    setChosenProduct(p)
    setResolvedProduct({ id: p.product_id, name: p.variant_name ? `${p.product_name} — ${p.variant_name}` : p.product_name })
    setSelectedSerials([])
    const sres = await fetch(`/api/admin/inventory/serials/available?product_id=${p.product_id}${p.variant_id ? `&variant_id=${p.variant_id}` : ''}`, { credentials: 'include' })
    const sdata = await sres.json().catch(() => ({}))
    setSerials(sdata.serials || [])
  }, [])

  // Hardware scanner (serial mode, not locked): a scan loads serials or selects one.
  useBarcodeScanner({ onScan: loadSerialsForProduct, enabled: mode === 'serial' && !lockProduct })

  function toggleBatch(b: BatchRow) {
    ensureBatchCount(b)
    setSelectedBatchIds(prev => prev.includes(b.id) ? prev.filter(x => x !== b.id) : [...prev, b.id])
  }
  function updateBatchCount(id: string, c: number) {
    setBatchCounts(prev => ({ ...prev, [id]: Math.max(1, Math.min(9999, Math.round(c) || 1)) }))
  }
  function toggleSerial(sn: string) {
    setSelectedSerials(prev => prev.includes(sn) ? prev.filter(x => x !== sn) : [...prev, sn])
  }

  // Total labels (batch: sum of per-batch counts × copies; serial: count × copies).
  const totalLabels = mode === 'batch'
    ? selectedBatchIds.reduce((s, id) => s + (batchCounts[id] ?? 1), 0) * copies
    : selectedSerials.length * copies

  // Preview: first selected item (or first listed), rendered batch/serial-specific.
  const previewBatch = mode === 'batch'
    ? (batches.find(b => b.id === (selectedBatchIds[0] ?? batches[0]?.id)) ?? null)
    : null
  const previewSerial = mode === 'serial'
    ? (() => {
        const sn = selectedSerials[0] ?? serials[0]?.serial_number
        const row = serials.find(s => s.serial_number === sn)
        if (!sn) return null
        return {
          productName: resolvedProduct?.name || 'Product',
          serialNumber: sn,
          sku: null,
          lotNumber: row?.lot_number ?? null,
        }
      })()
    : null

  async function download() {
    const payload: any = { copies, sheet: outputMode === 'sheet', size: selectedSize }
    if (mode === 'batch') {
      if (!selectedBatchIds.length) { showToast('Select at least one batch', 'error'); return }
      payload.batches = selectedBatchIds.map(id => ({ id, count: batchCounts[id] ?? 1 }))
    } else {
      if (!selectedSerials.length) { showToast('Select at least one serial', 'error'); return }
      payload.serial_numbers = selectedSerials
    }
    setDownloading(true)
    try {
      const res = await fetch('/api/admin/labels/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed') }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${mode}-labels-${new Date().toISOString().slice(0, 10)}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      showToast(e.message || 'Download failed', 'error')
    } finally { setDownloading(false) }
  }

  const selectedCount = mode === 'batch' ? selectedBatchIds.length : selectedSerials.length
  const previewScale = Math.min(200 / activeSize.widthPt, 240 / activeSize.heightPt)

  return (
    <div className={`grid ${compact ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[1fr_260px]'} gap-4`}>
      <div className="space-y-4 min-w-0">
        {/* Label Size */}
        <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">Label Size</h2>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {printableSizes.map(spec => {
              const isActive = spec.size === selectedSize
              const maxDim = Math.max(spec.widthMm, spec.heightMm)
              const rW = Math.round((spec.widthMm / maxDim) * 34)
              const rH = Math.round((spec.heightMm / maxDim) * 34)
              return (
                <button
                  key={spec.size}
                  type="button"
                  onClick={() => setSelectedSize(spec.size)}
                  className={`flex flex-col items-center gap-2 py-3 px-2 rounded-lg border-2 transition-all ${
                    isActive
                      ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                      : 'border-border-default hover:border-orange-300 bg-surface-secondary'
                  }`}
                >
                  <div className="flex items-center justify-center h-9 w-full">
                    <div
                      style={{ width: rW, height: rH }}
                      className={`border-2 rounded-sm transition-colors ${
                        isActive ? 'border-orange-500 bg-orange-100 dark:bg-orange-800/30' : 'border-border-strong'
                      }`}
                    />
                  </div>
                  <span className={`text-[11px] font-semibold leading-tight text-center ${
                    isActive ? 'text-orange-600 dark:text-orange-400' : 'text-foreground-secondary'
                  }`}>
                    {spec.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Output + copies */}
        <div className="bg-surface-elevated border border-border-default rounded-xl p-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            {(['thermal', 'sheet'] as const).map(m => (
              <button key={m} type="button" onClick={() => setOutputMode(m)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${outputMode === m ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'}`}>
                {m === 'thermal' ? 'Thermal (1/page)' : 'A4 sheet'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground-secondary">
            Copies
            <input type="number" min={1} max={100} value={copies}
              onChange={e => setCopies(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
              className="w-16 px-2 py-1 rounded-lg border border-border-default bg-surface text-sm" />
          </label>
          <button type="button" onClick={download} disabled={downloading || selectedCount === 0}
            className="ml-auto px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {downloading ? 'Generating…' : `Download PDF — ${totalLabels} label${totalLabels === 1 ? '' : 's'}`}
          </button>
        </div>

        {/* Picker */}
        {mode === 'batch' ? (
          <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
            <h2 className="text-sm font-semibold text-foreground mb-3">Select batches</h2>
            {!lockProduct && (
              <div className="mb-3">
                <AdminTypeahead
                  type="batch_products"
                  value={query}
                  onChange={setQuery}
                  onSelect={item => {
                    const parts = item.id.split('\x1f')
                    setQuery(parts[3] || parts[1] || '')
                  }}
                  placeholder="Search by lot number, product name or SKU…"
                  inputClassName="w-full px-3 py-1.5 pl-9 rounded-lg border border-border-default bg-surface-secondary text-foreground text-sm placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
            )}
            {loading ? (
              <p className="text-sm text-foreground-muted py-4 text-center">Loading…</p>
            ) : batches.length === 0 ? (
              <p className="text-sm text-foreground-muted py-4 text-center">No batches found.</p>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {batches.map(b => {
                  const sel = selectedBatchIds.includes(b.id)
                  const cnt = batchCounts[b.id] ?? Math.max(1, Math.round(Number(b.quantity_remaining) || 1))
                  return (
                    <div key={b.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${sel ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'border-border-default'}`}>
                      <button type="button" onClick={() => toggleBatch(b)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${sel ? 'border-orange-500 bg-orange-500' : 'border-border-strong'}`}>
                          {sel && <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={2}><path d="M1.5 5L4 7.5 8.5 2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{b.product_name}{b.variant_name ? ` — ${b.variant_name}` : ''}</p>
                          <p className="text-[11px] text-foreground-muted">LOT {b.lot_number || '—'} · EXP {fmtDate(b.expiry_date)} · Qty {Number(b.quantity_remaining)}</p>
                        </div>
                      </button>
                      {sel && (
                        <div className="flex items-center gap-1 shrink-0" title="Labels to print for this batch">
                          <button type="button" onClick={() => updateBatchCount(b.id, cnt - 1)} className="w-6 h-6 rounded border border-border-default text-foreground-secondary hover:bg-surface-secondary">−</button>
                          <input type="number" min={1} value={cnt}
                            onChange={e => updateBatchCount(b.id, parseInt(e.target.value) || 1)}
                            className="w-12 px-1 py-0.5 text-center text-sm rounded border border-border-default bg-surface" />
                          <button type="button" onClick={() => updateBatchCount(b.id, cnt + 1)} className="w-6 h-6 rounded border border-border-default text-foreground-secondary hover:bg-surface-secondary">+</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
            <h2 className="text-sm font-semibold text-foreground mb-1">Select serials</h2>
            {/* Product picker: pick a serialized product, then its in-stock serials load.
                Skipped when the popup locks a single product, or once a product is chosen. */}
            {!lockProduct && !chosenProduct ? (
              <>
                <p className="text-[11px] text-foreground-muted mb-3">Pick a serialized product to print its serial stickers. You can also scan a product/serial with a hardware scanner.</p>
                <div className="mb-3">
                  <AdminTypeahead
                    type="serial_products"
                    value={serialProductQuery}
                    onChange={setSerialProductQuery}
                    onSelect={item => {
                      const parts = item.id.split('\x1f')
                      const rawId = parts[0] ?? ''
                      const productId = parts[12] || ''
                      const parentVariantId = parts[14] || ''
                      const variantId = rawId.startsWith('variant:') ? rawId.slice('variant:'.length) : (parentVariantId || null)
                      const name = parts[2] ? `${parts[1]} — ${parts[2]}` : (parts[1] ?? '')
                      if (productId) chooseSerialProduct({ product_id: productId, variant_id: variantId, product_name: parts[1] ?? '', sku: parts[3] ?? '', variant_name: parts[2] || null, in_stock_count: 0 })
                    }}
                    placeholder="Search serialized products by name or SKU…"
                    inputClassName="w-full px-3 py-1.5 pl-9 rounded-lg border border-border-default bg-surface-secondary text-foreground text-sm placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                </div>
                {serialProductsLoading ? (
                  <p className="text-sm text-foreground-muted py-4 text-center">Loading…</p>
                ) : serialProducts.length === 0 ? (
                  <p className="text-sm text-foreground-muted py-4 text-center">No serialized products with in-stock serials.</p>
                ) : (
                  <div className="space-y-1.5 max-h-96 overflow-y-auto">
                    {serialProducts.map(p => (
                      <button key={`${p.product_id}:${p.variant_id || ''}`} type="button" onClick={() => chooseSerialProduct(p)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-border-default hover:bg-surface-secondary text-left transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{p.product_name}{p.variant_name ? ` — ${p.variant_name}` : ''}</p>
                          <p className="text-[11px] text-foreground-muted font-mono"><span className="inline-flex items-center gap-1">{p.sku}{p.sku && <CopySku sku={p.sku} />}</span></p>
                        </div>
                        <span className="text-[11px] text-foreground-muted shrink-0">{p.in_stock_count} in stock</span>
                        <svg className="w-4 h-4 text-foreground-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                {resolvedProduct && (
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-foreground-secondary">Product: <span className="font-medium text-foreground">{resolvedProduct.name}</span></p>
                    {!lockProduct && (
                      <button type="button" onClick={() => { setChosenProduct(null); setSerials([]); setSelectedSerials([]); setResolvedProduct(null) }}
                        className="text-xs text-orange-500 hover:text-orange-600 font-medium">Change product</button>
                    )}
                  </div>
                )}
            {serials.length > 0 && (
              <div className="flex items-center justify-between mb-2">
                <button type="button" onClick={() => setSelectedSerials(serials.map(s => s.serial_number))}
                  className="text-xs text-orange-500 hover:text-orange-600 font-medium">Select all ({serials.length})</button>
                {selectedSerials.length > 0 && <button type="button" onClick={() => setSelectedSerials([])} className="text-xs text-foreground-muted hover:text-foreground">Clear</button>}
              </div>
            )}
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {serials.map(s => {
                const sel = selectedSerials.includes(s.serial_number)
                return (
                  <button key={s.serial_number} type="button" onClick={() => toggleSerial(s.serial_number)}
                    className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-lg border text-left transition-colors ${sel ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'border-border-default hover:bg-surface-secondary'}`}>
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${sel ? 'border-orange-500 bg-orange-500' : 'border-border-strong'}`}>
                      {sel && <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={2}><path d="M1.5 5L4 7.5 8.5 2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                    <span className="text-sm font-mono text-foreground truncate">{s.serial_number}</span>
                    {s.lot_number && <span className="text-[10px] text-foreground-muted ml-auto shrink-0">LOT {s.lot_number}</span>}
                  </button>
                )
              })}
            </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Preview */}
      <div className={compact ? '' : 'lg:sticky lg:top-4 self-start'}>
        <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-foreground">Preview</h3>
            <span className="text-[11px] text-foreground-muted">{activeSize.label}</span>
          </div>
          <div className="flex items-center justify-center bg-surface-secondary rounded-lg p-4 min-h-[120px]">
            <BatchSerialPreview size={activeSize} mode={mode} batch={mode === 'batch' ? (previewBatch ? {
              productName: previewBatch.product_name, variantName: previewBatch.variant_name,
              sku: previewBatch.sku, lotNumber: previewBatch.lot_number,
              expiryDate: fmtDate(previewBatch.expiry_date), quantity: Math.round(Number(previewBatch.quantity_remaining) || 0),
            } : null) : null} serial={mode === 'serial' ? previewSerial : null} scale={previewScale} />
          </div>
          <div className="mt-3 space-y-1 text-[11px]">
            <div className="flex justify-between"><span className="text-foreground-muted">Size</span><span className="text-foreground">{activeSize.label}</span></div>
            <div className="flex justify-between"><span className="text-foreground-muted">Format</span><span className="text-foreground">{outputMode === 'sheet' ? 'A4 Sheet' : 'Thermal'}</span></div>
            <div className="flex justify-between"><span className="text-foreground-muted">Items</span><span className="text-foreground">{selectedCount}</span></div>
            <div className="flex justify-between"><span className="text-foreground-muted">Total labels</span><span className="text-foreground font-semibold">{totalLabels || '—'}</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
