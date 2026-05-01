'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { LabelSpec, LabelSize } from '@/lib/label-pdf'

interface ProductResult {
  id: string
  name: string
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

function fmtPrice(p: number | null): string {
  if (p == null) return ''
  return `Rs. ${Number(p).toFixed(2)}`
}

function QRPlaceholder({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="opacity-70">
      <rect x="5" y="5" width="35" height="35" fill="none" stroke="#555" strokeWidth="8"/>
      <rect x="15" y="15" width="15" height="15" fill="#555"/>
      <rect x="60" y="5" width="35" height="35" fill="none" stroke="#555" strokeWidth="8"/>
      <rect x="70" y="15" width="15" height="15" fill="#555"/>
      <rect x="5" y="60" width="35" height="35" fill="none" stroke="#555" strokeWidth="8"/>
      <rect x="15" y="70" width="15" height="15" fill="#555"/>
      {[0,1,2,3,4].map(i => (
        <rect key={i} x={55 + i * 9} y={60} width={5} height={35} fill="#555" opacity={0.5 + (i % 3) * 0.15}/>
      ))}
    </svg>
  )
}

function BarcodePlaceholder({ width, height }: { width: number; height: number }) {
  const bars = 28
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {Array.from({ length: bars }).map((_, i) => {
        const x = Math.round(i * (width / bars))
        const w = Math.max(1, (i % 3 === 0 ? 3 : i % 2 === 0 ? 2 : 1))
        return <rect key={i} x={x} y={0} width={w} height={height * 0.78} fill="#222"/>
      })}
      <text x={width / 2} y={height} textAnchor="middle" fontSize={height * 0.18} fill="#333" fontFamily="monospace">
        4006381333931
      </text>
    </svg>
  )
}

function LabelPreview({ size, product, scale }: { size: LabelSpec; product: ProductResult | null; scale: number }) {
  const w = size.widthPt * scale
  const h = size.heightPt * scale
  const pad = 4 * scale
  const price = product ? (product.sale_price ?? product.base_price) : null
  const hasMrp = product && product.mrp && product.mrp !== price
  const name = product?.name || 'Product Name'
  const sku = product?.sku || 'SKU-001'
  const brand = product?.brand_name || ''
  const barH = Math.round(h * 0.22)
  const fontSize = Math.max(6, Math.round(h * 0.12))
  const smallFont = Math.max(5, Math.round(h * 0.09))

  if (size.size === '30x20' || size.size === '80x20') {
    const isLandscape = size.size === '80x20'
    return (
      <div
        style={{ width: w, height: h, border: '1px solid #ccc', background: '#fff', position: 'relative', overflow: 'hidden', borderRadius: 2 }}
      >
        <div style={{ position: 'absolute', top: pad, left: pad, right: isLandscape ? w * 0.42 : pad, overflow: 'hidden' }}>
          <div style={{ fontSize: fontSize * 0.85, fontWeight: 700, lineHeight: 1.2, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {name}
          </div>
        </div>
        {isLandscape && price && (
          <div style={{ position: 'absolute', top: pad, right: pad, fontSize: Math.round(fontSize * 0.9), fontWeight: 700, color: '#e65100' }}>
            {fmtPrice(price)}
          </div>
        )}
        <div style={{ position: 'absolute', bottom: pad, left: pad, right: pad }}>
          <BarcodePlaceholder width={isLandscape ? w * 0.55 : w - pad * 2} height={barH} />
        </div>
      </div>
    )
  }

  if (size.size === '30x50') {
    return (
      <div style={{ width: w, height: h, border: '1px solid #ccc', background: '#fff', position: 'relative', overflow: 'hidden', borderRadius: 2 }}>
        <div style={{ position: 'absolute', top: pad, left: pad, right: pad, bottom: barH + pad * 2 + 10, overflow: 'hidden' }}>
          <div style={{ fontSize: fontSize, fontWeight: 700, lineHeight: 1.3, color: '#111' }}>{name}</div>
          <div style={{ fontSize: smallFont, color: '#666', marginTop: 3 }}>{sku}</div>
        </div>
        <div style={{ position: 'absolute', bottom: pad, left: pad, right: pad }}>
          <BarcodePlaceholder width={w - pad * 2} height={barH} />
        </div>
      </div>
    )
  }

  if (size.size === '40x60') {
    const qrSize = Math.round(w * 0.26)
    return (
      <div style={{ width: w, height: h, border: '1px solid #ccc', background: '#fff', position: 'relative', overflow: 'hidden', borderRadius: 2 }}>
        <div style={{ position: 'absolute', top: pad, left: pad, right: qrSize + pad * 2, overflow: 'hidden' }}>
          <div style={{ fontSize: fontSize, fontWeight: 700, lineHeight: 1.25, color: '#111' }}>{name}</div>
          <div style={{ fontSize: smallFont, color: '#555', marginTop: 2 }}>SKU: {sku}</div>
          {hasMrp && (
            <div style={{ fontSize: smallFont * 0.9, color: '#999', marginTop: 2, textDecoration: 'line-through' }}>
              {fmtPrice(product!.mrp)}
            </div>
          )}
          {price && (
            <div style={{ fontSize: Math.round(fontSize * 1.1), fontWeight: 700, color: '#e65100', marginTop: 1 }}>
              {fmtPrice(price)}
            </div>
          )}
        </div>
        <div style={{ position: 'absolute', top: pad, right: pad }}>
          <QRPlaceholder size={qrSize} />
        </div>
        <div style={{ position: 'absolute', bottom: pad, left: pad, right: pad }}>
          <BarcodePlaceholder width={w - pad * 2} height={barH} />
        </div>
      </div>
    )
  }

  if (size.size === '50x50') {
    const qrSize = Math.round(w * 0.27)
    return (
      <div style={{ width: w, height: h, border: '1px solid #ccc', background: '#fff', position: 'relative', overflow: 'hidden', borderRadius: 2 }}>
        <div style={{ position: 'absolute', top: pad, left: pad, width: qrSize }}>
          <QRPlaceholder size={qrSize} />
        </div>
        <div style={{ position: 'absolute', top: pad, left: qrSize + pad * 2, right: pad, overflow: 'hidden' }}>
          <div style={{ fontSize: Math.round(fontSize * 1.1), fontWeight: 700, lineHeight: 1.25, color: '#111' }}>{name}</div>
          {brand && <div style={{ fontSize: smallFont, color: '#888', marginTop: 2 }}>{brand}</div>}
          {hasMrp && (
            <div style={{ fontSize: smallFont * 0.9, color: '#999', marginTop: 3, textDecoration: 'line-through' }}>
              {fmtPrice(product!.mrp)}
            </div>
          )}
          {price && (
            <div style={{ fontSize: Math.round(fontSize * 1.2), fontWeight: 700, color: '#e65100', marginTop: 1 }}>
              {fmtPrice(price)}
            </div>
          )}
        </div>
        <div style={{ position: 'absolute', bottom: pad + 6, left: pad, right: pad, fontSize: smallFont, color: '#555' }}>
          SKU: {sku}
        </div>
        <div style={{ position: 'absolute', bottom: pad, left: pad, right: pad }}>
          <BarcodePlaceholder width={w - pad * 2} height={barH} />
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
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const activeSize = labelSizes.find(s => s.size === selectedSize)!

  const previewScale = Math.min(
    280 / activeSize.widthPt,
    360 / activeSize.heightPt
  )

  const search = useCallback(async (q: string) => {
    setSearching(true)
    try {
      const res = await fetch(`/api/admin/labels/products?q=${encodeURIComponent(q)}&limit=20`)
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
    debounceRef.current = setTimeout(() => search(query), 300)
  }, [query, search])

  useEffect(() => {
    search('')
  }, [search])

  function toggleProduct(p: ProductResult) {
    setSelectedProducts(prev => {
      const exists = prev.find(sp => sp.id === p.id)
      if (exists) return prev.filter(sp => sp.id !== p.id)
      return [...prev, { ...p, copies: 1 }]
    })
  }

  function updateProductCopies(id: string, copies: number) {
    setSelectedProducts(prev => prev.map(p => p.id === id ? { ...p, copies: Math.max(1, Math.min(100, copies)) } : p))
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
  const previewProduct = selectedProducts[0] || searchResults[0] || null

  return (
    <div className="flex flex-col xl:flex-row gap-6">
      {/* Left panel */}
      <div className="flex-1 space-y-5 min-w-0">

        {/* Size selector */}
        <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">Label Size</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {labelSizes.map(spec => {
              const isActive = spec.size === selectedSize
              const maxDim = Math.max(spec.widthMm, spec.heightMm)
              const rectW = Math.round((spec.widthMm / maxDim) * 32)
              const rectH = Math.round((spec.heightMm / maxDim) * 32)
              return (
                <button
                  key={spec.size}
                  onClick={() => setSelectedSize(spec.size)}
                  className={`flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                    isActive
                      ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
                      : 'border-border-default hover:border-accent-300 bg-surface-secondary'
                  }`}
                >
                  <div className="flex items-center justify-center h-10 w-full">
                    <div
                      style={{ width: rectW, height: rectH }}
                      className={`border-2 rounded-sm ${isActive ? 'border-accent-500 bg-accent-100 dark:bg-accent-800/30' : 'border-border-strong bg-surface-primary'}`}
                    />
                  </div>
                  <span className={`text-xs font-semibold leading-tight text-center ${isActive ? 'text-accent-600 dark:text-accent-400' : 'text-foreground-secondary'}`}>
                    {spec.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Output mode + copies */}
        <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-foreground mb-2">Output Format</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setOutputMode('thermal')}
                  className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                    outputMode === 'thermal'
                      ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-600 dark:text-accent-400'
                      : 'border-border-default text-foreground-secondary hover:border-accent-300'
                  }`}
                >
                  Thermal (per page)
                </button>
                <button
                  onClick={() => setOutputMode('sheet')}
                  className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                    outputMode === 'sheet'
                      ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-600 dark:text-accent-400'
                      : 'border-border-default text-foreground-secondary hover:border-accent-300'
                  }`}
                >
                  A4 Sheet grid
                </button>
              </div>
              <p className="text-xs text-foreground-muted mt-1.5">
                {outputMode === 'thermal' ? 'One label per page — for thermal/label printers' : 'Multiple labels per A4 page — for regular printers'}
              </p>
            </div>
            <div className="sm:w-36">
              <h2 className="text-sm font-semibold text-foreground mb-2">Copies per product</h2>
              <input
                type="number"
                min={1}
                max={100}
                value={copies}
                onChange={e => setCopies(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface-secondary text-foreground text-sm"
              />
            </div>
          </div>
        </div>

        {/* Product search */}
        <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">Select Products</h2>
          <div className="relative mb-3">
            <input
              type="text"
              placeholder="Search by name or SKU…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full px-3 py-2 pl-9 rounded-lg border border-border-default bg-surface-secondary text-foreground text-sm placeholder:text-foreground-muted"
            />
            <svg className="absolute left-3 top-2.5 w-4 h-4 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
          </div>

          <div className="space-y-1 max-h-72 overflow-y-auto">
            {searching && (
              <div className="text-sm text-foreground-muted text-center py-4">Searching…</div>
            )}
            {!searching && searchResults.length === 0 && (
              <div className="text-sm text-foreground-muted text-center py-4">No products found</div>
            )}
            {searchResults.map(p => {
              const isSelected = selectedProducts.some(sp => sp.id === p.id)
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                    isSelected ? 'bg-accent-50 dark:bg-accent-900/20' : 'hover:bg-surface-secondary'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleProduct(p)}
                    className="accent-accent-500 w-4 h-4 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{p.name}</div>
                    <div className="text-xs text-foreground-muted">{p.sku}{p.brand_name ? ` · ${p.brand_name}` : ''}</div>
                  </div>
                  <div className="text-xs font-medium text-foreground-secondary shrink-0">
                    {fmtPrice(p.sale_price ?? p.base_price)}
                  </div>
                </label>
              )
            })}
          </div>
        </div>

        {/* Selected products */}
        {selectedProducts.length > 0 && (
          <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
            <h2 className="text-sm font-semibold text-foreground mb-3">
              Selected ({selectedProducts.length} product{selectedProducts.length !== 1 ? 's' : ''})
            </h2>
            <div className="space-y-2">
              {selectedProducts.map(p => (
                <div key={p.id} className="flex items-center gap-3 bg-surface-secondary rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{p.name}</div>
                    <div className="text-xs text-foreground-muted">{p.sku}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs text-foreground-muted">qty:</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={p.copies}
                      onChange={e => updateProductCopies(p.id, parseInt(e.target.value) || 1)}
                      className="w-14 px-2 py-1 rounded border border-border-default bg-surface-primary text-foreground text-xs text-center"
                    />
                  </div>
                  <button
                    onClick={() => toggleProduct(p)}
                    className="text-foreground-muted hover:text-red-500 transition-colors"
                    aria-label="Remove"
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
          className="w-full flex items-center justify-center gap-2 py-3 px-6 bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          {downloading ? 'Generating PDF…' : `Download PDF${totalLabels > 0 ? ` (${totalLabels} label${totalLabels !== 1 ? 's' : ''})` : ''}`}
        </button>
      </div>

      {/* Right panel — preview */}
      <div className="xl:w-80 shrink-0">
        <div className="bg-surface-elevated border border-border-default rounded-xl p-4 sticky top-4">
          <h2 className="text-sm font-semibold text-foreground mb-1">Preview</h2>
          <p className="text-xs text-foreground-muted mb-4">{activeSize.label} · {activeSize.widthMm}×{activeSize.heightMm} mm</p>

          <div className="flex items-center justify-center bg-surface-secondary rounded-lg p-6 min-h-48">
            <div style={{ position: 'relative' }}>
              {/* dimension annotations */}
              <div style={{
                position: 'absolute',
                top: -20,
                left: 0,
                width: activeSize.widthPt * previewScale,
                textAlign: 'center',
                fontSize: 10,
                color: '#888',
              }}>
                {activeSize.widthMm} mm
              </div>
              <div style={{
                position: 'absolute',
                top: 0,
                left: -(28),
                height: activeSize.heightPt * previewScale,
                display: 'flex',
                alignItems: 'center',
                fontSize: 10,
                color: '#888',
                writingMode: 'vertical-rl',
                transform: 'rotate(180deg)',
              }}>
                {activeSize.heightMm} mm
              </div>
              <LabelPreview
                size={activeSize}
                product={previewProduct}
                scale={previewScale}
              />
            </div>
          </div>

          {!previewProduct && (
            <p className="text-xs text-foreground-muted text-center mt-3">
              Select a product to see it in the preview
            </p>
          )}
          {previewProduct && (
            <p className="text-xs text-foreground-muted text-center mt-3 truncate">
              Showing: {previewProduct.name}
            </p>
          )}

          <div className="mt-4 pt-4 border-t border-border-default space-y-1.5">
            <div className="flex justify-between text-xs text-foreground-secondary">
              <span>Size</span>
              <span className="font-medium text-foreground">{activeSize.label}</span>
            </div>
            <div className="flex justify-between text-xs text-foreground-secondary">
              <span>Format</span>
              <span className="font-medium text-foreground">{outputMode === 'thermal' ? 'Thermal / per page' : 'A4 sheet'}</span>
            </div>
            <div className="flex justify-between text-xs text-foreground-secondary">
              <span>Products</span>
              <span className="font-medium text-foreground">{selectedProducts.length}</span>
            </div>
            <div className="flex justify-between text-xs text-foreground-secondary">
              <span>Total labels</span>
              <span className="font-medium text-foreground">{totalLabels}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
