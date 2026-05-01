'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { LabelSpec, LabelSize } from '@/lib/label-pdf'

interface ProductResult {
  id: string
  product_id?: string
  variant_id?: string | null
  name: string
  variant_name?: string | null
  sku: string
  slug: string
  mrp: number | null
  sale_price: number | null
  base_price: number
  brand_name: string | null
  gtin: string | null
}

interface SelectedProduct extends ProductResult {
  copies: number
}

interface Props {
  labelSizes: LabelSpec[]
}

function fmtPrice(p: number | null | undefined): string {
  if (!p || p === 0) return ''
  return `Rs. ${Number(p).toFixed(2)}`
}

const BARCODE_BARS = [3,1,2,1,3,1,1,2,1,2,3,1,2,1,1,2,3,1,1,2,2,1,3,1,2,1,2,1,3,1,1]

function BarcodePlaceholder({ width, height, text }: { width: number; height: number; text: string }) {
  const totalW = BARCODE_BARS.reduce((s, b) => s + b, 0)
  let curX = 0
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      {BARCODE_BARS.map((barW, i) => {
        const x = (curX / totalW) * width
        const w = (barW / totalW) * width
        curX += barW
        return i % 2 === 0
          ? <rect key={i} x={x} y={0} width={Math.max(0.5, w - 0.5)} height={height * 0.8} fill="#1a1a1a"/>
          : null
      })}
      <text
        x={width / 2} y={height * 0.98}
        textAnchor="middle"
        fontSize={Math.max(5, height * 0.17)}
        fill="#333"
        fontFamily="monospace"
        dominantBaseline="auto"
      >
        {text.slice(0, 16)}
      </text>
    </svg>
  )
}

function QRPlaceholder({ size }: { size: number }) {
  const cells = [
    [1,1,1,1,1,1,1,0,1,0,0,1,0,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,1,0,0,1,0,0,0,1,0,0,0,0,0,0,1],
    [1,0,1,1,1,0,1,0,1,0,1,0,1,1,0,1,1,1,0,0,1],
    [1,0,1,1,1,0,1,0,0,0,0,1,0,1,0,1,1,1,0,0,1],
    [1,0,0,0,0,0,1,0,1,1,0,0,1,1,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,0,1,0,1,0,1,0,1,1,1,1,1,1,1],
    [0,0,0,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0],
    [1,0,1,1,0,1,0,1,0,0,1,0,0,1,0,0,1,1,0,1,1],
    [0,1,0,0,1,0,1,0,1,1,0,0,1,0,1,0,0,1,1,0,0],
    [1,0,0,1,0,1,0,0,0,0,1,1,0,1,0,0,1,0,0,1,0],
    [0,0,1,0,0,0,1,1,0,1,0,0,1,0,1,1,0,0,1,0,1],
    [0,0,0,0,0,0,0,0,1,0,1,0,0,1,0,0,0,1,0,1,0],
    [1,1,1,1,1,1,1,0,0,1,0,1,1,0,1,0,1,0,1,0,1],
    [1,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,1,0],
    [1,0,1,1,1,0,1,0,0,0,1,1,0,0,1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1,0,1,0,0,1,0,1,0,1,0,0,0,1,0],
    [1,0,0,0,0,0,1,0,0,1,1,0,1,0,1,1,1,1,0,1,1],
    [1,1,1,1,1,1,1,0,1,0,0,0,0,1,0,0,0,1,0,0,1],
  ]
  const cols = cells[0].length
  const rows = cells.length
  const cs = size / cols
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <rect width={size} height={size} fill="white"/>
      {cells.flatMap((row, ri) =>
        row.map((cell, ci) =>
          cell ? <rect key={`${ri}-${ci}`} x={ci * cs} y={ri * cs} width={cs} height={cs} fill="#111"/> : null
        )
      )}
    </svg>
  )
}

function LabelPreview({ size, product, scale }: {
  size: LabelSpec
  product: ProductResult | null
  scale: number
}) {
  const w = Math.round(size.widthPt * scale)
  const h = Math.round(size.heightPt * scale)
  const pad = Math.max(4, Math.round(3.5 * scale))

  const name = product?.name || 'Product Name'
  const variantName = product?.variant_name || null
  const sku = product?.sku || 'SKU-001'
  const brand = product?.brand_name || null
  const price = product ? (product.sale_price ?? product.base_price) : null
  const mrp = product?.mrp ?? null
  const hasMrp = mrp && mrp > 0 && mrp !== price

  const barH = Math.round(h * 0.24)
  const nameFontSize = Math.max(7, Math.round(h * 0.115))
  const smallFontSize = Math.max(6, Math.round(h * 0.085))
  const priceFontSize = Math.max(8, Math.round(h * 0.135))
  const barcodeText = product?.gtin || product?.sku || '0000000000000'

  const base: React.CSSProperties = {
    width: w,
    height: h,
    position: 'relative',
    overflow: 'hidden',
    background: '#ffffff',
    border: '1px solid #d1d5db',
    borderRadius: 2,
    boxSizing: 'border-box',
    fontFamily: 'Helvetica, Arial, sans-serif',
  }

  if (size.size === '30x20') {
    const nameFs = Math.max(6, Math.round(h * 0.12))
    const varFs = Math.max(5, Math.round(h * 0.09))
    return (
      <div style={base}>
        <div style={{ position: 'absolute', top: pad, left: pad, right: pad, bottom: barH + pad, overflow: 'hidden' }}>
          <div style={{ fontSize: nameFs, fontWeight: 700, lineHeight: 1.2, color: '#111', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{name}</div>
          {variantName && (
            <div style={{ fontSize: varFs, color: '#555', marginTop: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{variantName}</div>
          )}
        </div>
        <div style={{ position: 'absolute', bottom: pad, left: pad, right: pad }}>
          <BarcodePlaceholder width={w - pad * 2} height={barH} text={barcodeText} />
        </div>
      </div>
    )
  }

  if (size.size === '80x20') {
    const nameFs = Math.max(6, Math.round(h * 0.13))
    const varFs = Math.max(5, Math.round(h * 0.095))
    const nameColW = Math.round(w * 0.5)
    const priceColW = Math.round(w * 0.3)
    return (
      <div style={base}>
        <div style={{ position: 'absolute', top: pad, left: pad, width: nameColW - pad * 2, overflow: 'hidden' }}>
          <div style={{ fontSize: nameFs, fontWeight: 700, lineHeight: 1.2, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
          {variantName && (
            <div style={{ fontSize: varFs, color: '#555', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{variantName}</div>
          )}
        </div>
        {price && price > 0 && (
          <div style={{ position: 'absolute', top: pad, right: pad, width: priceColW, textAlign: 'right', fontSize: Math.round(nameFs * 1.05), fontWeight: 700, color: '#c0392b' }}>
            {fmtPrice(price)}
          </div>
        )}
        <div style={{ position: 'absolute', bottom: pad, left: pad }}>
          <BarcodePlaceholder width={Math.round(w * 0.52)} height={barH} text={barcodeText} />
        </div>
        <div style={{ position: 'absolute', bottom: pad + Math.round(barH * 0.25), left: pad + Math.round(w * 0.54), fontSize: Math.max(5, Math.round(h * 0.09)), color: '#555' }}>
          {sku}
        </div>
      </div>
    )
  }

  if (size.size === '30x50') {
    return (
      <div style={base}>
        <div style={{ position: 'absolute', top: pad, left: pad, right: pad, bottom: barH + pad + 14, overflow: 'hidden' }}>
          <div style={{ fontSize: nameFontSize, fontWeight: 700, lineHeight: 1.3, color: '#111' }}>{name}</div>
          {variantName && (
            <div style={{ fontSize: smallFontSize, color: '#333', marginTop: 2, lineHeight: 1.2 }}>{variantName}</div>
          )}
        </div>
        <div style={{ position: 'absolute', bottom: barH + pad + 2, left: pad, right: pad, fontSize: smallFontSize * 0.9, color: '#777' }}>
          {sku}
        </div>
        <div style={{ position: 'absolute', bottom: pad, left: pad, right: pad }}>
          <BarcodePlaceholder width={w - pad * 2} height={barH} text={barcodeText} />
        </div>
      </div>
    )
  }

  if (size.size === '40x60') {
    const qrSize = Math.round(Math.min(w, h) * 0.27)
    const textRight = w - qrSize - pad * 2 - 2
    return (
      <div style={base}>
        <div style={{ position: 'absolute', top: pad, right: pad }}>
          <QRPlaceholder size={qrSize} />
        </div>
        <div style={{ position: 'absolute', top: pad, left: pad, right: qrSize + pad * 2 + 2, overflow: 'hidden' }}>
          <div style={{ fontSize: nameFontSize, fontWeight: 700, lineHeight: 1.25, color: '#111', maxHeight: variantName ? nameFontSize * 1.3 : nameFontSize * 2.7, overflow: 'hidden' }}>{name}</div>
          {variantName && (
            <div style={{ fontSize: smallFontSize, color: '#333', marginTop: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{variantName}</div>
          )}
          <div style={{ fontSize: smallFontSize * 0.9, color: '#666', marginTop: 2 }}>SKU: {sku}</div>
          <div style={{ marginTop: 3 }}>
            {hasMrp && (
              <span style={{ fontSize: smallFontSize * 0.85, color: '#aaa', textDecoration: 'line-through', marginRight: 3 }}>{fmtPrice(mrp)}</span>
            )}
            {price && price > 0 && (
              <span style={{ fontSize: priceFontSize * 0.95, fontWeight: 700, color: '#c0392b' }}>{fmtPrice(price)}</span>
            )}
          </div>
        </div>
        <div style={{ position: 'absolute', bottom: pad, left: pad, right: pad }}>
          <BarcodePlaceholder width={w - pad * 2} height={barH} text={barcodeText} />
        </div>
      </div>
    )
  }

  if (size.size === '50x50') {
    const qrSize = Math.round(w * 0.28)
    const rightX = pad + qrSize + Math.round(pad * 0.8)
    const rightW = w - rightX - pad
    return (
      <div style={base}>
        <div style={{ position: 'absolute', top: pad, left: pad }}>
          <QRPlaceholder size={qrSize} />
        </div>
        <div style={{ position: 'absolute', top: pad, left: rightX, right: pad, overflow: 'hidden' }}>
          <div style={{ fontSize: nameFontSize, fontWeight: 700, lineHeight: 1.25, color: '#111', maxHeight: variantName ? nameFontSize * 1.4 : nameFontSize * 2.8, overflow: 'hidden' }}>{name}</div>
          {variantName && (
            <div style={{ fontSize: smallFontSize, color: '#333', marginTop: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{variantName}</div>
          )}
          {brand && (
            <div style={{ fontSize: smallFontSize * 0.85, color: '#888', marginTop: 1 }}>{brand}</div>
          )}
          <div style={{ marginTop: 3 }}>
            {hasMrp && (
              <div style={{ fontSize: smallFontSize * 0.85, color: '#aaa', textDecoration: 'line-through' }}>{fmtPrice(mrp)}</div>
            )}
            {price && price > 0 && (
              <div style={{ fontSize: priceFontSize, fontWeight: 700, color: '#c0392b', marginTop: 1 }}>{fmtPrice(price)}</div>
            )}
          </div>
        </div>
        <div style={{ position: 'absolute', bottom: barH + pad + 2, left: pad, right: pad, fontSize: smallFontSize * 0.85, color: '#666' }}>
          SKU: {sku}
        </div>
        <div style={{ position: 'absolute', bottom: pad, left: pad, right: pad }}>
          <BarcodePlaceholder width={w - pad * 2} height={barH} text={barcodeText} />
        </div>
      </div>
    )
  }

  return null
}

export default function LabelsClient({ labelSizes }: Props) {
  const [selectedSize, setSelectedSize] = useState<LabelSize>('40x60')
  const [outputMode, setOutputMode] = useState<'thermal' | 'sheet'>('thermal')
  const [copies, setCopies] = useState(1)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ProductResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const activeSize = labelSizes.find(s => s.size === selectedSize)!

  const PREVIEW_MAX_W = 260
  const PREVIEW_MAX_H = 300
  const previewScale = Math.min(
    PREVIEW_MAX_W / activeSize.widthPt,
    PREVIEW_MAX_H / activeSize.heightPt
  )

  const search = useCallback(async (q: string) => {
    setSearching(true)
    try {
      const res = await fetch(`/api/admin/labels/products?q=${encodeURIComponent(q)}&limit=30`)
      const data = await res.json()
      setSearchResults(data.products || [])
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(query), 280)
  }, [query, search])

  useEffect(() => { search('') }, [search])

  useEffect(() => {
    setPreviewIndex(0)
  }, [selectedProducts.length])

  function toggleProduct(p: ProductResult) {
    setSelectedProducts(prev => {
      const exists = prev.find(sp => sp.id === p.id)
      if (exists) return prev.filter(sp => sp.id !== p.id)
      return [...prev, { ...p, copies: 1 }]
    })
  }

  function updateProductCopies(id: string, c: number) {
    setSelectedProducts(prev => prev.map(p => p.id === id ? { ...p, copies: Math.max(1, Math.min(100, c)) } : p))
  }

  async function handleDownload() {
    if (selectedProducts.length === 0) return
    setError('')
    setDownloading(true)
    try {
      const res = await fetch('/api/admin/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_ids: selectedProducts.map(p => p.id),
          size: selectedSize,
          copies,
          sheet: outputMode === 'sheet',
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to generate labels')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `labels-${selectedSize}-${new Date().toISOString().slice(0, 10)}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e.message || 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  const totalLabels = selectedProducts.reduce((sum, p) => sum + p.copies, 0) * copies
  const safePreviewIdx = Math.min(previewIndex, Math.max(0, selectedProducts.length - 1))
  const previewProduct = selectedProducts.length > 0 ? selectedProducts[safePreviewIdx] : searchResults[0] || null

  return (
    <div className="flex flex-col xl:flex-row gap-6 items-start">

      {/* ── Left panel ── */}
      <div className="flex-1 min-w-0 space-y-4">

        {/* Size selector */}
        <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">Label Size</h2>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {labelSizes.map(spec => {
              const isActive = spec.size === selectedSize
              const maxDim = Math.max(spec.widthMm, spec.heightMm)
              const rW = Math.round((spec.widthMm / maxDim) * 34)
              const rH = Math.round((spec.heightMm / maxDim) * 34)
              return (
                <button
                  key={spec.size}
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
        <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-foreground mb-2">Output Format</h2>
              <div className="flex gap-2">
                {(['thermal', 'sheet'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setOutputMode(m)}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      outputMode === m
                        ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400'
                        : 'border-border-default text-foreground-secondary hover:border-orange-300'
                    }`}
                  >
                    {m === 'thermal' ? 'Thermal (per page)' : 'A4 Sheet grid'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-foreground-muted mt-1.5">
                {outputMode === 'thermal' ? 'One label per page — ideal for thermal/label printers' : 'Multiple labels per A4 page with cut lines — for desktop printers'}
              </p>
            </div>
            <div className="sm:w-32">
              <h2 className="text-sm font-semibold text-foreground mb-2">Copies per item</h2>
              <input
                type="number" min={1} max={100} value={copies}
                onChange={e => setCopies(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface-secondary text-foreground text-sm"
              />
            </div>
          </div>
        </div>

        {/* Product / variant search */}
        <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">Select Products & Variants</h2>
          <div className="relative mb-3">
            <input
              type="text"
              placeholder="Search by name, variant or SKU…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full px-3 py-2 pl-9 rounded-lg border border-border-default bg-surface-secondary text-foreground text-sm placeholder:text-foreground-muted"
            />
            <svg className="absolute left-3 top-2.5 w-4 h-4 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
          </div>

          <div className="space-y-0.5 max-h-72 overflow-y-auto">
            {searching && <div className="text-sm text-foreground-muted text-center py-6">Searching…</div>}
            {!searching && searchResults.length === 0 && (
              <div className="text-sm text-foreground-muted text-center py-6">No products found</div>
            )}
            {!searching && searchResults.map(p => {
              const isSelected = selectedProducts.some(sp => sp.id === p.id)
              const displayPrice = fmtPrice(p.sale_price ?? p.base_price)
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                    isSelected ? 'bg-orange-50 dark:bg-orange-900/20' : 'hover:bg-surface-secondary'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleProduct(p)}
                    className="w-4 h-4 flex-shrink-0 accent-orange-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate leading-tight">{p.name}</div>
                    {p.variant_name && (
                      <div className="text-xs text-foreground-secondary truncate">{p.variant_name}</div>
                    )}
                    <div className="text-xs text-foreground-muted">{p.sku}{p.brand_name ? ` · ${p.brand_name}` : ''}</div>
                  </div>
                  {displayPrice && (
                    <div className="text-xs font-medium text-foreground-secondary shrink-0">{displayPrice}</div>
                  )}
                </label>
              )
            })}
          </div>
        </div>

        {/* Selected basket */}
        {selectedProducts.length > 0 && (
          <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground">
                Selected — {selectedProducts.length} item{selectedProducts.length !== 1 ? 's' : ''}
              </h2>
              <button
                onClick={() => setSelectedProducts([])}
                className="text-xs text-foreground-muted hover:text-red-500 transition-colors"
              >
                Clear all
              </button>
            </div>
            <div className="space-y-1.5">
              {selectedProducts.map((p, idx) => (
                <div key={p.id} className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors cursor-pointer ${
                  idx === safePreviewIdx ? 'bg-orange-50 dark:bg-orange-900/20 ring-1 ring-orange-200 dark:ring-orange-800' : 'bg-surface-secondary'
                }`}
                  onClick={() => setPreviewIndex(idx)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate leading-tight">{p.name}</div>
                    {p.variant_name && <div className="text-xs text-foreground-secondary">{p.variant_name}</div>}
                    <div className="text-xs text-foreground-muted">{p.sku}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs text-foreground-muted">qty</span>
                    <input
                      type="number" min={1} max={100} value={p.copies}
                      onChange={e => updateProductCopies(p.id, parseInt(e.target.value) || 1)}
                      onClick={e => e.stopPropagation()}
                      className="w-12 px-1.5 py-1 rounded border border-border-default bg-surface-primary text-foreground text-xs text-center"
                    />
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); toggleProduct(p) }}
                    className="text-foreground-muted hover:text-red-500 transition-colors flex-shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        <button
          onClick={handleDownload}
          disabled={selectedProducts.length === 0 || downloading}
          className="w-full flex items-center justify-center gap-2 py-3 px-6 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors text-sm"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          {downloading
            ? 'Generating PDF…'
            : selectedProducts.length === 0
              ? 'Select products to download'
              : `Download PDF — ${totalLabels} label${totalLabels !== 1 ? 's' : ''}`
          }
        </button>
      </div>

      {/* ── Right panel — preview ── */}
      <div className="w-full xl:w-72 shrink-0">
        <div className="bg-surface-elevated border border-border-default rounded-xl p-4 sticky top-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-foreground">Preview</h2>
            <span className="text-xs text-foreground-muted">{activeSize.label}</span>
          </div>
          <p className="text-xs text-foreground-muted mb-3">
            {activeSize.widthMm} × {activeSize.heightMm} mm
          </p>

          {/* Preview box */}
          <div className="bg-[#f0f0f0] dark:bg-zinc-800 rounded-lg flex items-center justify-center py-8 px-4 min-h-44 relative">
            {/* ruler top */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[9px] text-foreground-muted select-none">
              ←── {activeSize.widthMm} mm ──→
            </div>
            <div style={{ position: 'relative' }}>
              {/* ruler left */}
              <div style={{
                position: 'absolute',
                left: -22,
                top: 0,
                height: activeSize.heightPt * previewScale,
                display: 'flex',
                alignItems: 'center',
                fontSize: 9,
                color: '#999',
                writingMode: 'vertical-rl',
                transform: 'rotate(180deg)',
                userSelect: 'none',
              }}>
                {activeSize.heightMm} mm
              </div>
              <LabelPreview size={activeSize} product={previewProduct} scale={previewScale} />
            </div>
          </div>

          {/* Multi-product carousel nav */}
          {selectedProducts.length > 1 && (
            <div className="flex items-center justify-between mt-3">
              <button
                onClick={() => setPreviewIndex(i => Math.max(0, i - 1))}
                disabled={safePreviewIdx === 0}
                className="px-3 py-1.5 rounded-lg border border-border-default text-xs font-medium text-foreground-secondary disabled:opacity-40 hover:bg-surface-secondary transition-colors"
              >
                ← Prev
              </button>
              <span className="text-xs text-foreground-muted">
                {safePreviewIdx + 1} / {selectedProducts.length}
              </span>
              <button
                onClick={() => setPreviewIndex(i => Math.min(selectedProducts.length - 1, i + 1))}
                disabled={safePreviewIdx === selectedProducts.length - 1}
                className="px-3 py-1.5 rounded-lg border border-border-default text-xs font-medium text-foreground-secondary disabled:opacity-40 hover:bg-surface-secondary transition-colors"
              >
                Next →
              </button>
            </div>
          )}

          {previewProduct ? (
            <p className="text-xs text-foreground-muted text-center mt-2 truncate">
              {previewProduct.name}{previewProduct.variant_name ? ` — ${previewProduct.variant_name}` : ''}
            </p>
          ) : (
            <p className="text-xs text-foreground-muted text-center mt-2">
              Select a product to preview
            </p>
          )}

          {/* Summary */}
          <div className="mt-4 pt-3 border-t border-border-default grid grid-cols-2 gap-y-1.5">
            {[
              ['Size', activeSize.label],
              ['Format', outputMode === 'thermal' ? 'Thermal' : 'A4 sheet'],
              ['Items', selectedProducts.length],
              ['Total labels', totalLabels || '—'],
            ].map(([label, val]) => (
              <div key={label} className="contents">
                <span className="text-xs text-foreground-muted">{label}</span>
                <span className="text-xs font-medium text-foreground text-right">{val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
