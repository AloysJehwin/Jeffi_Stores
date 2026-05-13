'use client'

import { useState, useEffect, useCallback } from 'react'
import { LABEL_SIZES, LabelSpec, LabelSize } from '@/lib/label-sizes'

interface LabelEntry {
  id: string
  name: string
  variant_name: string | null
  sku: string
  mrp: number | null
  sale_price: number | null
  base_price: number
  gst_percentage: number
  brand_name: string | null
}

interface Props {
  product: { id: string; name: string; has_variants: boolean } | null
  onClose: () => void
}

const BARS = [3,1,2,1,3,1,1,2,1,2,3,1,2,1,1,2,3,1,1,2,2,1,3,1,2,1,2,1,3,1,1]
function Barcode({ w, h, text }: { w: number; h: number; text: string }) {
  const total = BARS.reduce((s, b) => s + b, 0)
  let cx = 0
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      {BARS.map((bw, i) => {
        const x = (cx / total) * w
        const bwPx = (bw / total) * w
        cx += bw
        return i % 2 === 0
          ? <rect key={i} x={x} y={0} width={Math.max(0.5, bwPx - 0.5)} height={h * 0.8} fill="#1a1a1a"/>
          : null
      })}
      <text x={w/2} y={h*0.98} textAnchor="middle" fontSize={Math.max(5, h*0.17)} fill="#333" fontFamily="monospace" dominantBaseline="auto">
        {text.slice(0,16)}
      </text>
    </svg>
  )
}

const QR_CELLS = [
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
function QR({ size }: { size: number }) {
  const cols = QR_CELLS[0].length
  const cs = size / cols
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <rect width={size} height={size} fill="white"/>
      {QR_CELLS.flatMap((row, ri) => row.map((c, ci) =>
        c ? <rect key={`${ri}-${ci}`} x={ci*cs} y={ri*cs} width={cs} height={cs} fill="#111"/> : null
      ))}
    </svg>
  )
}

function LabelPreview({ spec, entry, scale }: { spec: LabelSpec; entry: LabelEntry | null; scale: number }) {
  const w = Math.round(spec.widthPt * scale)
  const h = Math.round(spec.heightPt * scale)
  const pad = Math.max(3, Math.round(2.5 * scale))
  const barH = Math.round(h * 0.22)

  const name = entry?.name || 'Product Name'
  const variantName = entry?.variant_name || null
  const sku = entry?.sku || 'SKU-001'
  const brand = entry?.brand_name || null
  const exGst = entry ? (entry.sale_price ?? entry.base_price) : null
  const mrp = entry?.mrp ?? null
  const gstPct = entry?.gst_percentage ?? 0
  const gstFactor = 1 + (gstPct || 0) / 100
  const incGst = exGst ? Number((exGst * gstFactor).toFixed(2)) : null
  const mrpInc = mrp && mrp > 0 ? Number((mrp * gstFactor).toFixed(2)) : null
  const showMrp = mrpInc && incGst && mrpInc !== incGst

  const nameFs = Math.round(8 * scale)
  const smallFs = Math.round(5.5 * scale)
  const priceFs = Math.round(10 * scale)

  const base: React.CSSProperties = {
    width: w, height: h, position: 'relative', overflow: 'hidden',
    background: '#fff', border: '1px solid #d1d5db', borderRadius: 2,
    boxSizing: 'border-box', fontFamily: 'Helvetica, Arial, sans-serif', flexShrink: 0,
  }

  if (spec.size === '30x20') {
    const fs = Math.round(5 * scale)
    const vfs = Math.round(4.5 * scale)
    return (
      <div style={base}>
        <div style={{ position:'absolute', top:pad, left:pad, right:pad, bottom:barH+pad, overflow:'hidden' }}>
          <div style={{ fontSize:fs, fontWeight:700, lineHeight:1.2, color:'#111', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{name}</div>
          {variantName && <div style={{ fontSize:vfs, color:'#555', marginTop:1, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{variantName}</div>}
          {incGst && <div style={{ marginTop:1, fontSize:fs, fontWeight:700, color:'#c0392b', lineHeight:1 }}>Rs. {incGst.toFixed(2)}</div>}
        </div>
        <div style={{ position:'absolute', bottom:pad, left:pad, right:pad }}>
          <Barcode w={w-pad*2} h={barH} text={sku} />
        </div>
      </div>
    )
  }

  if (spec.size === '80x20') {
    const fs = Math.round(7 * scale)
    const vfs = Math.round(6 * scale)
    const pfs = Math.round(6.5 * scale)
    const efs = Math.round(4.5 * scale)
    return (
      <div style={base}>
        <div style={{ position:'absolute', top:pad, left:pad, right:pad, bottom:barH+pad, overflow:'hidden', display:'flex', flexDirection:'column', justifyContent:'center' }}>
          <div style={{ fontSize:fs, fontWeight:700, color:'#111', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', lineHeight:1.2 }}>{name}</div>
          {variantName && <div style={{ fontSize:vfs, color:'#555', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', lineHeight:1.2 }}>{variantName}</div>}
          {incGst && (
            <div style={{ display:'flex', alignItems:'baseline', gap:Math.round(3*scale), flexWrap:'wrap' }}>
              {showMrp && <span style={{ fontSize:efs, color:'#aaa', textDecoration:'line-through' }}>Rs. {mrpInc!.toFixed(2)}</span>}
              <span style={{ fontSize:pfs, fontWeight:700, color:'#c0392b' }}>Rs. {incGst.toFixed(2)}</span>
              {gstPct > 0 && <span style={{ fontSize:efs, color:'#888' }}>ex.GST Rs. {Number(exGst).toFixed(2)}</span>}
            </div>
          )}
        </div>
        <div style={{ position:'absolute', bottom:pad, left:pad, right:pad }}>
          <Barcode w={w-pad*2} h={barH} text={sku} />
        </div>
      </div>
    )
  }

  if (spec.size === '30x50') {
    return (
      <div style={base}>
        <div style={{ position:'absolute', top:pad, left:pad, right:pad, bottom:barH+pad+12, overflow:'hidden' }}>
          <div style={{ fontSize:nameFs, fontWeight:700, lineHeight:1.3, color:'#111', overflow:'hidden', display:'-webkit-box', WebkitLineClamp:variantName?2:3, WebkitBoxOrient:'vertical' as any }}>{name}</div>
          {variantName && <div style={{ fontSize:smallFs, color:'#333', marginTop:1, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{variantName}</div>}
          {incGst && (
            <div style={{ marginTop:2 }}>
              {showMrp && <div style={{ fontSize:smallFs*0.85, color:'#aaa', textDecoration:'line-through', lineHeight:1 }}>Rs. {mrpInc!.toFixed(2)}</div>}
              <div style={{ fontSize:priceFs*0.9, fontWeight:700, color:'#c0392b', lineHeight:1 }}>Rs. {incGst.toFixed(2)}</div>
              {gstPct > 0 && <div style={{ fontSize:smallFs*0.85-1, color:'#888', lineHeight:1 }}>ex. GST Rs. {Number(exGst).toFixed(2)}</div>}
            </div>
          )}
        </div>
        <div style={{ position:'absolute', bottom:barH+pad+1, left:pad, right:pad, fontSize:smallFs*0.85, color:'#777', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{sku}</div>
        <div style={{ position:'absolute', bottom:pad, left:pad, right:pad }}>
          <Barcode w={w-pad*2} h={barH} text={sku} />
        </div>
      </div>
    )
  }

  if (spec.size === '40x60') {
    const qrSize = Math.round(Math.min(w,h)*0.27)
    return (
      <div style={base}>
        <div style={{ position:'absolute', top:pad, right:pad }}><QR size={qrSize}/></div>
        <div style={{ position:'absolute', top:pad, left:pad, right:qrSize+pad*2+2, bottom:barH+pad, overflow:'hidden' }}>
          <div style={{ fontSize:nameFs, fontWeight:700, lineHeight:1.25, color:'#111', overflow:'hidden', display:'-webkit-box', WebkitLineClamp:variantName?1:2, WebkitBoxOrient:'vertical' as any }}>{name}</div>
          {variantName && <div style={{ fontSize:smallFs, color:'#333', marginTop:1, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{variantName}</div>}
          <div style={{ fontSize:smallFs*0.9, color:'#666', marginTop:2 }}>SKU: {sku}</div>
          {incGst && (
            <div style={{ marginTop:3 }}>
              {showMrp && <div style={{ fontSize:smallFs*0.85, color:'#aaa', textDecoration:'line-through', lineHeight:1 }}>Rs. {mrpInc!.toFixed(2)}</div>}
              <div style={{ fontSize:priceFs*0.9, fontWeight:700, color:'#c0392b', lineHeight:1 }}>Rs. {incGst.toFixed(2)}</div>
              {gstPct > 0 && <div style={{ fontSize:smallFs*0.85-1, color:'#888', lineHeight:1 }}>ex. GST Rs. {Number(exGst).toFixed(2)}</div>}
            </div>
          )}
        </div>
        <div style={{ position:'absolute', bottom:pad, left:pad, right:pad }}>
          <Barcode w={w-pad*2} h={barH} text={sku} />
        </div>
      </div>
    )
  }

  if (spec.size === '50x50') {
    const qrSize = Math.round(w*0.29)
    const gapQ = Math.round(pad*0.7)
    const rightX = pad + qrSize + gapQ
    const rightW = w - rightX - pad
    const contentH = h - barH - pad*2 - 6
    const skuRowH = Math.round(smallFs*0.85) + 3
    const infoH = contentH - skuRowH
    return (
      <div style={base}>
        <div style={{ position:'absolute', top:pad, left:pad, width:qrSize, height:Math.min(qrSize,infoH), overflow:'hidden' }}><QR size={qrSize}/></div>
        <div style={{ position:'absolute', top:pad, left:rightX, width:rightW, height:infoH, overflow:'hidden' }}>
          <div style={{ fontSize:nameFs, fontWeight:700, lineHeight:1.25, color:'#111', overflow:'hidden', display:'-webkit-box', WebkitLineClamp:variantName?1:2, WebkitBoxOrient:'vertical' as any }}>{name}</div>
          {variantName && <div style={{ fontSize:smallFs, color:'#333', marginTop:1, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{variantName}</div>}
          {brand && <div style={{ fontSize:Math.round(smallFs*0.85), color:'#888', marginTop:1, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{brand}</div>}
          {incGst && (
            <div style={{ marginTop:3 }}>
              {showMrp && <div style={{ fontSize:smallFs*0.9, color:'#aaa', textDecoration:'line-through', lineHeight:1 }}>Rs. {mrpInc!.toFixed(2)}</div>}
              <div style={{ fontSize:priceFs, fontWeight:700, color:'#c0392b', lineHeight:1 }}>Rs. {incGst.toFixed(2)}</div>
              {gstPct > 0 && <div style={{ fontSize:smallFs*0.9, color:'#888', lineHeight:1 }}>ex. GST Rs. {Number(exGst).toFixed(2)}</div>}
            </div>
          )}
        </div>
        <div style={{ position:'absolute', bottom:barH+pad+1, left:pad, right:pad, fontSize:Math.round(smallFs*0.85), color:'#666', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>SKU: {sku}</div>
        <div style={{ position:'absolute', bottom:pad, left:pad, right:pad }}>
          <Barcode w={w-pad*2} h={barH} text={sku} />
        </div>
      </div>
    )
  }

  return null
}

export default function ProductLabelModal({ product, onClose }: Props) {
  const [entries, setEntries] = useState<LabelEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [size, setSize] = useState<LabelSize>('40x60')
  const [outputMode, setOutputMode] = useState<'thermal' | 'sheet'>('thermal')
  const [copies, setCopies] = useState(1)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const [modalSize, setModalSize] = useState<'sm' | 'md' | 'lg'>('md')

  const spec = LABEL_SIZES.find(s => s.size === size)!

  const PREV_MAX = 180
  const previewScale = Math.min(PREV_MAX / spec.widthPt, PREV_MAX / spec.heightPt)

  const previewEntry = previewId
    ? entries.find(e => e.id === previewId) ?? null
    : entries.find(e => selected.has(e.id)) ?? null

  useEffect(() => {
    if (!product) return
    setLoading(true)
    setEntries([])
    setSelected(new Set())
    setPreviewId(null)
    setError('')
    fetch(`/api/admin/labels/products?q=&limit=200&product_id=${product.id}`)
      .then(r => r.json())
      .then(d => {
        const rows: LabelEntry[] = (d.products || [])
        setEntries(rows)
        setSelected(new Set(rows.map((e: LabelEntry) => e.id)))
        if (rows.length > 0) setPreviewId(rows[0].id)
      })
      .catch(() => setError('Could not load label data'))
      .finally(() => setLoading(false))
  }, [product?.id])

  useEffect(() => {
    if (!product) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [product])

  const toggleEntry = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    setPreviewId(id)
  }, [])

  const selectAll = () => setSelected(new Set(entries.map(e => e.id)))
  const clearAll = () => setSelected(new Set())

  async function handleDownload() {
    const ids = entries.filter(e => selected.has(e.id)).map(e => e.id)
    if (ids.length === 0) return
    setError('')
    setDownloading(true)
    try {
      const res = await fetch('/api/admin/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_ids: ids, size, copies, sheet: outputMode === 'sheet' }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to generate labels')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `labels-${size}-${product!.name.slice(0,30).replace(/\s+/g,'-')}-${new Date().toISOString().slice(0,10)}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e.message || 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  if (!product) return null

  const totalLabels = selected.size * copies

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"/>
      <div
        className={`relative bg-surface-elevated w-full sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] flex flex-col transition-all ${
          modalSize === 'sm' ? 'sm:max-w-lg' : modalSize === 'lg' ? 'sm:max-w-4xl' : 'sm:max-w-2xl'
        }`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-border-default shrink-0">
          <div className="min-w-0 pr-4">
            <h2 className="text-base font-bold text-foreground leading-tight">Print Labels</h2>
            <p className="text-sm text-foreground-muted truncate mt-0.5">{product.name}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex border border-border-default rounded-lg overflow-hidden">
              {(['sm', 'md', 'lg'] as const).map((s, i) => (
                <button
                  key={s}
                  onClick={() => setModalSize(s)}
                  title={s === 'sm' ? 'Compact' : s === 'md' ? 'Normal' : 'Wide'}
                  className={`px-2 py-1 text-[10px] font-medium transition-colors ${i > 0 ? 'border-l border-border-default' : ''} ${
                    modalSize === s
                      ? 'bg-orange-500 text-white'
                      : 'text-foreground-muted hover:bg-surface-secondary'
                  }`}
                >
                  {s === 'sm' ? 'S' : s === 'md' ? 'M' : 'L'}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-muted hover:text-foreground transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          <div>
            <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2">Label Size</p>
            <div className="grid grid-cols-5 gap-1.5">
              {LABEL_SIZES.map(s => (
                <button
                  key={s.size}
                  onClick={() => setSize(s.size)}
                  className={`flex flex-col items-center gap-1.5 py-2 px-1 rounded-lg border-2 transition-all text-center ${
                    size === s.size
                      ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                      : 'border-border-default hover:border-orange-300 bg-surface-secondary'
                  }`}
                >
                  {(() => {
                    const maxD = Math.max(s.widthMm, s.heightMm)
                    const rW = Math.round((s.widthMm / maxD) * 24)
                    const rH = Math.round((s.heightMm / maxD) * 24)
                    return (
                      <div className="flex items-center justify-center h-7 w-full">
                        <div style={{ width: rW, height: rH }} className={`border-2 rounded-sm ${size === s.size ? 'border-orange-500 bg-orange-100 dark:bg-orange-800/30' : 'border-border-strong'}`}/>
                      </div>
                    )
                  })()}
                  <span className={`text-[9px] font-semibold leading-tight ${size === s.size ? 'text-orange-600 dark:text-orange-400' : 'text-foreground-muted'}`}>{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2">Format</p>
              <div className="flex gap-1.5">
                {(['thermal', 'sheet'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setOutputMode(m)}
                    className={`flex-1 py-1.5 px-2 rounded-lg border text-xs font-medium transition-colors ${
                      outputMode === m
                        ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400'
                        : 'border-border-default text-foreground-secondary hover:border-orange-300'
                    }`}
                  >
                    {m === 'thermal' ? 'Thermal' : 'A4 Sheet'}
                  </button>
                ))}
              </div>
            </div>
            <div className="w-28">
              <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2">Copies each</p>
              <input
                type="number" min={1} max={100} value={copies}
                onChange={e => setCopies(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                className="w-full px-2 py-1.5 rounded-lg border border-border-default bg-surface-secondary text-foreground text-sm"
              />
            </div>
          </div>

          <div className="flex gap-4 items-start">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                  {product.has_variants ? 'Variants' : 'Product'}
                </p>
                {entries.length > 1 && (
                  <div className="flex gap-2">
                    <button onClick={selectAll} className="text-[10px] text-accent-500 hover:text-accent-600">All</button>
                    <span className="text-foreground-muted text-[10px]">·</span>
                    <button onClick={clearAll} className="text-[10px] text-foreground-muted hover:text-red-500">None</button>
                  </div>
                )}
              </div>

              {loading ? (
                <div className="text-xs text-foreground-muted py-4 text-center">Loading…</div>
              ) : entries.length === 0 ? (
                <div className="text-xs text-foreground-muted py-4 text-center">No label data found</div>
              ) : (
                <div className="space-y-1 max-h-56 overflow-y-auto pr-1 py-0.5">
                  {entries.map(e => (
                    <label
                      key={e.id}
                      onClick={() => setPreviewId(e.id)}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                        previewId === e.id
                          ? 'bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700'
                          : 'hover:bg-surface-secondary border border-transparent'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(e.id)}
                        onChange={() => toggleEntry(e.id)}
                        onClick={ev => ev.stopPropagation()}
                        className="w-3.5 h-3.5 flex-shrink-0 accent-orange-500"
                      />
                      <div className="flex-1 min-w-0">
                        {e.variant_name
                          ? <div className="text-sm font-medium text-foreground truncate">{e.variant_name}</div>
                          : <div className="text-sm font-medium text-foreground truncate">{e.name}</div>
                        }
                        <div className="text-xs text-foreground-muted">{e.sku}</div>
                      </div>
                      <div className="text-xs font-semibold text-primary-500 shrink-0">
                        Rs. {Number(((e.sale_price ?? e.base_price) * (1 + (e.gst_percentage || 0) / 100))).toFixed(0)}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="shrink-0 flex flex-col items-center gap-2">
              <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide self-start">Preview</p>
              <div className="bg-[#f0f0f0] dark:bg-zinc-800 rounded-xl p-2 flex items-center justify-center min-w-[140px] min-h-[100px]">
                {spec && (
                  <LabelPreview spec={spec} entry={previewEntry} scale={previewScale} />
                )}
              </div>
              <p className="text-[10px] text-foreground-muted text-center">
                {spec.widthMm} × {spec.heightMm} mm
              </p>
              {previewEntry && (
                <p className="text-[10px] text-foreground-muted text-center max-w-[160px] truncate">
                  {previewEntry.variant_name || previewEntry.name}
                </p>
              )}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 text-xs text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border-default shrink-0 flex items-center justify-between gap-3">
          <p className="text-xs text-foreground-muted">
            {selected.size} {product.has_variants ? 'variant' : 'item'}{selected.size !== 1 ? 's' : ''} · {totalLabels} label{totalLabels !== 1 ? 's' : ''}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDownload}
              disabled={selected.size === 0 || downloading || loading}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              {downloading ? 'Generating…' : 'Download PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
