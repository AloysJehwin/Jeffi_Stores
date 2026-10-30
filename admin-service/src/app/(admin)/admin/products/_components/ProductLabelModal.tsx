'use client'

import { useState, useEffect, useCallback } from 'react'
import { LABEL_SIZES, LabelSpec, LabelSize } from '@/lib/documents/label-sizes'
import { round2 } from '@/lib/catalog/gst'
import CopySku from '@/components/ui/CopySku'
import { useToast } from '@/contexts/ToastContext'
import { Download } from 'lucide-react'
import { Dialog } from '@/components/admin/kit'
import Toggle from '@/components/ui/Toggle'

interface LabelEntry {
  id: string
  name: string
  variant_name: string | null
  sku: string
  mrp: number | null
  price_ex_gst: number | null
  base_price: number
  gst_percentage: number
  brand_name: string | null
  fragile?: boolean | null
  hazardous?: boolean | null
  flammable?: boolean | null
}

interface Props {
  product: { id: string; name: string; has_variants: boolean } | null
  onClose: () => void
}

const BARS = [3, 1, 2, 1, 3, 1, 1, 2, 1, 2, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 2, 1, 3, 1, 2, 1, 2, 1, 3, 1, 1]
function Barcode({ w, h, text }: { w: number; h: number; text: string }) {
  const total = BARS.reduce((s, b) => s + b, 0)
  let cx = 0
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      {BARS.map((bw, i) => {
        const x = (cx / total) * w
        const bwPx = (bw / total) * w
        cx += bw
        return i % 2 === 0 ? (
          <rect key={i} x={x} y={0} width={Math.max(0.5, bwPx - 0.5)} height={h * 0.8} fill="#1a1a1a" />
        ) : null
      })}
      <text
        x={w / 2}
        y={h * 0.98}
        textAnchor="middle"
        fontSize={Math.max(5, h * 0.17)}
        fill="#333"
        fontFamily="monospace"
        dominantBaseline="auto"
      >
        {text.slice(0, 16)}
      </text>
    </svg>
  )
}

const QR_CELLS = [
  [1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1],
  [0, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0],
  [1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
  [0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1],
  [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
  [1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0],
  [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0],
  [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1],
]
function QR({ size }: { size: number }) {
  const cols = QR_CELLS[0].length
  const cs = size / cols
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <rect width={size} height={size} fill="white" />
      {QR_CELLS.flatMap((row, ri) =>
        row.map((c, ci) =>
          c ? <rect key={`${ri}-${ci}`} x={ci * cs} y={ri * cs} width={cs} height={cs} fill="#111" /> : null
        )
      )}
    </svg>
  )
}

const WarnFlame = () => (
  <svg
    viewBox="0 0 10 14"
    fill="currentColor"
    style={{ width: '0.7em', height: '0.95em', display: 'inline', verticalAlign: 'middle', marginRight: '0.2em' }}
  >
    <path d="M5 0C5 0 2 4 2 7a3 3 0 006 0c0-.5-.1-1-.25-1.4.5.8.75 1.7.75 2.9a4 4 0 01-8 0C.5 5 5 0 5 0zm0 3C4.3 4.5 3.5 6 3.5 7.5a1.5 1.5 0 003 0C6.5 6.3 5.8 4.8 5 3z" />
  </svg>
)
const WarnTriangle = () => (
  <svg
    viewBox="0 0 12 12"
    fill="currentColor"
    style={{ width: '0.7em', height: '0.7em', display: 'inline', verticalAlign: 'middle', marginRight: '0.2em' }}
  >
    <path d="M6 1L11.5 11H.5L6 1zm0 2.5L2.2 10h7.6L6 3.5zM5.4 6h1.2v2.5H5.4V6zm0 3h1.2v1.2H5.4V9z" />
  </svg>
)
const WarnDiamond = () => (
  <svg
    viewBox="0 0 12 12"
    fill="currentColor"
    style={{ width: '0.7em', height: '0.7em', display: 'inline', verticalAlign: 'middle', marginRight: '0.2em' }}
  >
    <path d="M6 .5L11.5 6 6 11.5.5 6 6 .5zm0 2L2.5 6l1.8 1.8L5.5 6l1.5 2 1-2 .8 1.8L10.5 6 6 2.5z" />
  </svg>
)

function WarningIcons({
  entry,
  size,
  barH,
  pad,
}: {
  entry: LabelEntry | null
  size: number
  barH: number
  pad: number
}) {
  if (!entry) return null
  const badges: { key: string; label: string; color: string; bg: string; Icon: () => JSX.Element }[] = []
  if (entry.flammable)
    badges.push({ key: 'flammable', label: 'FLAMMABLE', color: '#fff', bg: '#c0392b', Icon: WarnFlame })
  if (entry.hazardous)
    badges.push({ key: 'hazardous', label: 'HAZARDOUS', color: '#fff', bg: '#e67e22', Icon: WarnTriangle })
  if (entry.fragile) badges.push({ key: 'fragile', label: 'FRAGILE', color: '#fff', bg: '#2980b9', Icon: WarnDiamond })
  if (badges.length === 0) return null
  const fs = Math.max(5, Math.round(size * 0.55))
  return (
    <div
      style={{
        position: 'absolute',
        bottom: barH + pad + 2,
        right: pad,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 2,
      }}
    >
      {badges.map(({ key, label, color, bg, Icon }) => (
        <div
          key={key}
          style={{
            background: bg,
            color,
            fontSize: fs,
            fontWeight: 700,
            fontFamily: 'Helvetica, Arial, sans-serif',
            padding: `1px ${Math.round(fs * 0.6)}px`,
            borderRadius: 2,
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
            letterSpacing: '0.02em',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Icon />
          {label}
        </div>
      ))}
    </div>
  )
}

function LabelPreview({
  spec,
  entry,
  scale,
  showPrice,
}: {
  spec: LabelSpec
  entry: LabelEntry | null
  scale: number
  showPrice: boolean
}) {
  const w = Math.round(spec.widthPt * scale)
  const h = Math.round(spec.heightPt * scale)
  const pad = Math.max(3, Math.round(2.5 * scale))
  const barH = Math.round(h * 0.22)

  const name = entry?.name || 'Product Name'
  const variantName = entry?.variant_name || null
  const sku = entry?.sku || 'SKU-001'
  const brand = entry?.brand_name || null
  const incGst = entry && entry.base_price ? round2(Number(entry.base_price)) : null
  const mrpInc = entry?.mrp && entry.mrp > 0 ? round2(Number(entry.mrp)) : null
  const gstPct = entry?.gst_percentage ?? 0
  const exGstDisplay = incGst && gstPct > 0 && entry?.price_ex_gst ? round2(Number(entry.price_ex_gst)) : null
  const showMrp = mrpInc && incGst && mrpInc !== incGst

  const nameFs = Math.round(8 * scale)
  const smallFs = Math.round(5.5 * scale)
  const priceFs = Math.round(10 * scale)

  const base: React.CSSProperties = {
    width: w,
    height: h,
    position: 'relative',
    overflow: 'hidden',
    background: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: 2,
    boxSizing: 'border-box',
    fontFamily: 'Helvetica, Arial, sans-serif',
    flexShrink: 0,
  }

  if (spec.size === '30x20') {
    const fs = Math.round(5 * scale)
    const vfs = Math.round(4.5 * scale)
    return (
      <div style={base}>
        <div style={{ position: 'absolute', top: pad, left: pad, right: pad, bottom: barH + pad, overflow: 'hidden' }}>
          <div
            style={{
              fontSize: fs,
              fontWeight: 700,
              lineHeight: 1.2,
              color: '#111',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            {name}
          </div>
          {variantName && (
            <div
              style={{
                fontSize: vfs,
                color: '#555',
                marginTop: 1,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
              }}
            >
              {variantName}
            </div>
          )}
          {showPrice && incGst && (
            <div style={{ marginTop: 1, fontSize: fs, fontWeight: 700, color: '#c0392b', lineHeight: 1 }}>
              Rs. {incGst.toFixed(2)}
            </div>
          )}
        </div>
        <div style={{ position: 'absolute', bottom: pad, left: pad, right: pad }}>
          <Barcode w={w - pad * 2} h={barH} text={sku} />
        </div>
        <WarningIcons entry={entry} size={Math.round(16 * scale)} barH={barH} pad={pad} />
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
        <div
          style={{
            position: 'absolute',
            top: pad,
            left: pad,
            right: pad,
            bottom: barH + pad,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              fontSize: fs,
              fontWeight: 700,
              color: '#111',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: 1.2,
            }}
          >
            {name}
          </div>
          {variantName && (
            <div
              style={{
                fontSize: vfs,
                color: '#555',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                lineHeight: 1.2,
              }}
            >
              {variantName}
            </div>
          )}
          {showPrice && incGst && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: Math.round(3 * scale), flexWrap: 'wrap' }}>
              {showMrp && (
                <span style={{ fontSize: efs, color: '#aaa', textDecoration: 'line-through' }}>
                  Rs. {mrpInc!.toFixed(2)}
                </span>
              )}
              <span style={{ fontSize: pfs, fontWeight: 700, color: '#c0392b' }}>Rs. {incGst.toFixed(2)}</span>
              {gstPct > 0 && (
                <span style={{ fontSize: efs, color: '#888' }}>ex.GST Rs. {exGstDisplay!.toFixed(2)}</span>
              )}
            </div>
          )}
        </div>
        <div style={{ position: 'absolute', bottom: pad, left: pad, right: pad }}>
          <Barcode w={w - pad * 2} h={barH} text={sku} />
        </div>
        <WarningIcons entry={entry} size={Math.round(16 * scale)} barH={barH} pad={pad} />
      </div>
    )
  }

  if (spec.size === '30x50') {
    return (
      <div style={base}>
        <div
          style={{ position: 'absolute', top: pad, left: pad, right: pad, bottom: barH + pad + 12, overflow: 'hidden' }}
        >
          <div
            style={{
              fontSize: nameFs,
              fontWeight: 700,
              lineHeight: 1.3,
              color: '#111',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: variantName ? 2 : 3,
              WebkitBoxOrient: 'vertical' as any,
            }}
          >
            {name}
          </div>
          {variantName && (
            <div
              style={{
                fontSize: smallFs,
                color: '#333',
                marginTop: 1,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
              }}
            >
              {variantName}
            </div>
          )}
          {showPrice && incGst && (
            <div style={{ marginTop: 2 }}>
              {showMrp && (
                <div style={{ fontSize: smallFs * 0.85, color: '#aaa', textDecoration: 'line-through', lineHeight: 1 }}>
                  Rs. {mrpInc!.toFixed(2)}
                </div>
              )}
              <div style={{ fontSize: priceFs * 0.9, fontWeight: 700, color: '#c0392b', lineHeight: 1 }}>
                Rs. {incGst.toFixed(2)}
              </div>
              {gstPct > 0 && (
                <div style={{ fontSize: smallFs * 0.85 - 1, color: '#888', lineHeight: 1 }}>
                  ex. GST Rs. {exGstDisplay!.toFixed(2)}
                </div>
              )}
            </div>
          )}
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: barH + pad + 1,
            left: pad,
            right: pad,
            fontSize: smallFs * 0.85,
            color: '#777',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {sku}
        </div>
        <div style={{ position: 'absolute', bottom: pad, left: pad, right: pad }}>
          <Barcode w={w - pad * 2} h={barH} text={sku} />
        </div>
        <WarningIcons entry={entry} size={Math.round(18 * scale)} barH={barH} pad={pad} />
      </div>
    )
  }

  if (spec.size === '40x60') {
    const qrSize = Math.round(Math.min(w, h) * 0.27)
    return (
      <div style={base}>
        <div style={{ position: 'absolute', top: pad, right: pad }}>
          <QR size={qrSize} />
        </div>
        <div
          style={{
            position: 'absolute',
            top: pad,
            left: pad,
            right: qrSize + pad * 2 + 2,
            bottom: barH + pad,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              fontSize: nameFs,
              fontWeight: 700,
              lineHeight: 1.25,
              color: '#111',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: variantName ? 1 : 2,
              WebkitBoxOrient: 'vertical' as any,
            }}
          >
            {name}
          </div>
          {variantName && (
            <div
              style={{
                fontSize: smallFs,
                color: '#333',
                marginTop: 1,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
              }}
            >
              {variantName}
            </div>
          )}
          <div style={{ fontSize: smallFs * 0.9, color: '#666', marginTop: 2 }}>SKU: {sku}</div>
          {showPrice && incGst && (
            <div style={{ marginTop: 3 }}>
              {showMrp && (
                <div style={{ fontSize: smallFs * 0.85, color: '#aaa', textDecoration: 'line-through', lineHeight: 1 }}>
                  Rs. {mrpInc!.toFixed(2)}
                </div>
              )}
              <div style={{ fontSize: priceFs * 0.9, fontWeight: 700, color: '#c0392b', lineHeight: 1 }}>
                Rs. {incGst.toFixed(2)}
              </div>
              {gstPct > 0 && (
                <div style={{ fontSize: smallFs * 0.85 - 1, color: '#888', lineHeight: 1 }}>
                  ex. GST Rs. {exGstDisplay!.toFixed(2)}
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{ position: 'absolute', bottom: pad, left: pad, right: pad }}>
          <Barcode w={w - pad * 2} h={barH} text={sku} />
        </div>
        <WarningIcons entry={entry} size={Math.round(18 * scale)} barH={barH} pad={pad} />
      </div>
    )
  }

  if (spec.size === '50x50') {
    const qrSize = Math.round(w * 0.29)
    const gapQ = Math.round(pad * 0.7)
    const rightX = pad + qrSize + gapQ
    const rightW = w - rightX - pad
    const contentH = h - barH - pad * 2 - 6
    const skuRowH = Math.round(smallFs * 0.85) + 3
    const infoH = contentH - skuRowH
    return (
      <div style={base}>
        <div
          style={{
            position: 'absolute',
            top: pad,
            left: pad,
            width: qrSize,
            height: Math.min(qrSize, infoH),
            overflow: 'hidden',
          }}
        >
          <QR size={qrSize} />
        </div>
        <div style={{ position: 'absolute', top: pad, left: rightX, width: rightW, height: infoH, overflow: 'hidden' }}>
          <div
            style={{
              fontSize: nameFs,
              fontWeight: 700,
              lineHeight: 1.25,
              color: '#111',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: variantName ? 1 : 2,
              WebkitBoxOrient: 'vertical' as any,
            }}
          >
            {name}
          </div>
          {variantName && (
            <div
              style={{
                fontSize: smallFs,
                color: '#333',
                marginTop: 1,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
              }}
            >
              {variantName}
            </div>
          )}
          {brand && (
            <div
              style={{
                fontSize: Math.round(smallFs * 0.85),
                color: '#888',
                marginTop: 1,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
              }}
            >
              {brand}
            </div>
          )}
          {showPrice && incGst && (
            <div style={{ marginTop: 3 }}>
              {showMrp && (
                <div style={{ fontSize: smallFs * 0.9, color: '#aaa', textDecoration: 'line-through', lineHeight: 1 }}>
                  Rs. {mrpInc!.toFixed(2)}
                </div>
              )}
              <div style={{ fontSize: priceFs, fontWeight: 700, color: '#c0392b', lineHeight: 1 }}>
                Rs. {incGst.toFixed(2)}
              </div>
              {gstPct > 0 && (
                <div style={{ fontSize: smallFs * 0.9, color: '#888', lineHeight: 1 }}>
                  ex. GST Rs. {exGstDisplay!.toFixed(2)}
                </div>
              )}
            </div>
          )}
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: barH + pad + 1,
            left: pad,
            right: pad,
            fontSize: Math.round(smallFs * 0.85),
            color: '#666',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          SKU: {sku}
        </div>
        <div style={{ position: 'absolute', bottom: pad, left: pad, right: pad }}>
          <Barcode w={w - pad * 2} h={barH} text={sku} />
        </div>
        <WarningIcons entry={entry} size={Math.round(18 * scale)} barH={barH} pad={pad} />
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
  const [showPrice, setShowPrice] = useState(false)
  const { showToast } = useToast()

  const spec = LABEL_SIZES.find(s => s.size === size)!

  const PREV_MAX = 180
  const previewScale = Math.min(PREV_MAX / spec.widthPt, PREV_MAX / spec.heightPt)

  const previewEntry = previewId
    ? (entries.find(e => e.id === previewId) ?? null)
    : (entries.find(e => selected.has(e.id)) ?? null)

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
        const rows: LabelEntry[] = d.products || []
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
    return () => {
      document.body.style.overflow = ''
    }
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
    setDownloading(true)
    try {
      const res = await fetch('/api/admin/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_ids: ids, size, copies, sheet: outputMode === 'sheet', showPrice }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to generate labels')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `labels-${size}-${product!.name.slice(0, 30).replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      showToast(e.message || 'Download failed', 'error')
    } finally {
      setDownloading(false)
    }
  }

  if (!product) return null

  const totalLabels = selected.size * copies

  const sizeToggle = (
    <div className="flex border border-border-default rounded-lg overflow-hidden">
      {(['sm', 'md', 'lg'] as const).map((s, i) => (
        <button
          key={s}
          type="button"
          onClick={() => setModalSize(s)}
          title={s === 'sm' ? 'Compact' : s === 'md' ? 'Normal' : 'Wide'}
          className={`px-2 h-6 text-[10px] font-medium transition-colors ${i > 0 ? 'border-l border-border-default' : ''} ${
            modalSize === s ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:bg-surface-secondary'
          }`}
        >
          {s === 'sm' ? 'S' : s === 'md' ? 'M' : 'L'}
        </button>
      ))}
    </div>
  )

  return (
    <Dialog
      open={!!product}
      onClose={onClose}
      zIndex="z-[300]"
      size={modalSize === 'sm' ? 'md' : modalSize === 'lg' ? 'xl' : 'lg'}
      title={
        <span className="flex items-center gap-3">
          Print Labels
          {sizeToggle}
        </span>
      }
      description={product.name}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-foreground-muted">
            {selected.size} item{selected.size !== 1 ? 's' : ''} · {totalLabels} label{totalLabels !== 1 ? 's' : ''}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="control-md border border-border-default text-foreground-secondary hover:bg-surface-secondary">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={selected.size === 0 || downloading || loading}
              className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              {downloading ? 'Generating…' : 'Download PDF'}
            </button>
          </div>
        </div>
      }
    >
      <div className="-m-5">
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
                      ? 'border-accent-500 bg-accent-500/5'
                      : 'border-border-default hover:border-accent-300 bg-surface-secondary'
                  }`}
                >
                  {(() => {
                    const maxD = Math.max(s.widthMm, s.heightMm)
                    const rW = Math.round((s.widthMm / maxD) * 24)
                    const rH = Math.round((s.heightMm / maxD) * 24)
                    return (
                      <div className="flex items-center justify-center h-7 w-full">
                        <div
                          style={{ width: rW, height: rH }}
                          className={`border-2 rounded-sm ${size === s.size ? 'border-accent-500 bg-accent-500/15' : 'border-border-strong'}`}
                        />
                      </div>
                    )
                  })()}
                  <span
                    className={`text-[9px] font-semibold leading-tight ${size === s.size ? 'text-accent-500' : 'text-foreground-muted'}`}
                  >
                    {s.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="flex-1">
              <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2">Format</p>
              <div className="flex gap-1.5">
                {(['thermal', 'sheet'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setOutputMode(m)}
                    className={`flex-1 h-control-sm px-2 rounded-lg border text-xs font-medium transition-colors ${
                      outputMode === m
                        ? 'border-accent-500 bg-accent-500/5 text-accent-500'
                        : 'border-border-default text-foreground-secondary hover:border-accent-300'
                    }`}
                  >
                    {m === 'thermal' ? 'Thermal' : 'A4 Sheet'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2">
                Copies each
              </p>
              <input
                type="number"
                min={1}
                max={100}
                value={copies}
                onChange={e => setCopies(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                className="w-full px-2 h-control-sm rounded-lg border border-border-default bg-surface-secondary text-foreground text-sm"
              />
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2">
                Print Price
              </p>
              <Toggle id="label-show-price" size="sm" checked={showPrice} onChange={setShowPrice} label={showPrice ? 'On' : 'Off'} />
            </div>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                  {product.has_variants ? 'Variants' : 'Product'}
                </p>
                {entries.length > 1 && (
                  <div className="flex gap-2">
                    <button onClick={selectAll} className="text-[10px] text-accent-500 hover:text-accent-600">
                      All
                    </button>
                    <span className="text-foreground-muted text-[10px]">·</span>
                    <button onClick={clearAll} className="text-[10px] text-foreground-muted hover:text-red-500">
                      None
                    </button>
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
                          ? 'bg-accent-500/5 border border-accent-500/40'
                          : 'hover:bg-surface-secondary border border-transparent'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(e.id)}
                        onChange={() => toggleEntry(e.id)}
                        onClick={ev => ev.stopPropagation()}
                        className="w-3.5 h-3.5 flex-shrink-0 accent-accent-500"
                      />
                      <div className="flex-1 min-w-0">
                        {e.variant_name ? (
                          <div className="text-sm font-medium text-foreground truncate">{e.variant_name}</div>
                        ) : (
                          <div className="text-sm font-medium text-foreground truncate">{e.name}</div>
                        )}
                        <div className="text-xs text-foreground-muted">
                          <span className="inline-flex items-center gap-1">
                            {e.sku}
                            {e.sku && <CopySku sku={e.sku} />}
                          </span>
                        </div>
                      </div>
                      <div className="text-xs font-semibold text-primary-500 shrink-0">
                        Rs. {Number(e.base_price).toFixed(2)}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="shrink-0 flex flex-col items-center gap-2">
              <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide self-start">
                Preview
              </p>
              <div className="bg-surface-secondary rounded-xl p-2 flex items-center justify-center min-w-[140px] min-h-[100px]">
                {spec && <LabelPreview spec={spec} entry={previewEntry} scale={previewScale} showPrice={showPrice} />}
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
            <div className="bg-red-500/5 border border-red-500/40 rounded-lg px-3 py-2 text-xs text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

      </div>
    </Dialog>
  )
}
