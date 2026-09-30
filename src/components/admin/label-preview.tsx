'use client'

import React from 'react'
import { LabelSpec } from '@/lib/label-sizes'

// Shared client-side label preview components. These mirror the server PDF
// renderers (src/lib/label-pdf.ts) closely enough for an at-a-glance preview;
// the placeholder QR/barcode are decorative (the real ones are drawn in the PDF).
// Extracted from LabelsClient so the Product tab, the batch/serial picker, and the
// label popups all render the same preview.

export interface PreviewProduct {
  name: string
  variant_name?: string | null
  sku: string
  brand_name?: string | null
  mrp?: number | null
  price_ex_gst?: number | null
  base_price?: number
  gst_percentage?: number
}

export function fmtPrice(p: number | null | undefined): string {
  if (!p || p === 0) return ''
  return `Rs. ${Number(p).toFixed(0)}`
}

export function PriceBlock({
  exGst,
  mrp,
  gstPct,
  mainSize,
  subSize,
  gap,
}: {
  exGst: number | null
  mrp: number | null
  gstPct: number
  mainSize: number
  subSize: number
  gap: number
}) {
  if (!exGst || exGst === 0) return null
  const gstFactor = 1 + (gstPct || 0) / 100
  const incGst = Number((exGst * gstFactor).toFixed(2))
  const mrpIncGst = mrp && mrp > 0 ? Number((mrp * gstFactor).toFixed(2)) : null
  const showExGst = gstPct > 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {mrpIncGst && mrpIncGst !== incGst && (
        <span style={{ fontSize: subSize, color: '#aaa', textDecoration: 'line-through', lineHeight: 1 }}>
          Rs. {mrpIncGst.toFixed(2)}
        </span>
      )}
      <span style={{ fontSize: mainSize, fontWeight: 700, color: '#c0392b', lineHeight: 1 }}>
        Rs. {incGst.toFixed(2)}
      </span>
      {showExGst && (
        <span style={{ fontSize: subSize - 1, color: '#888', lineHeight: 1 }}>
          ex. GST Rs. {Number(exGst).toFixed(2)}
        </span>
      )}
    </div>
  )
}

const BARCODE_BARS = [3, 1, 2, 1, 3, 1, 1, 2, 1, 2, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 2, 1, 3, 1, 2, 1, 2, 1, 3, 1, 1]

export function BarcodePlaceholder({ width, height, text }: { width: number; height: number; text: string }) {
  const totalW = BARCODE_BARS.reduce((s, b) => s + b, 0)
  let curX = 0
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      {BARCODE_BARS.map((barW, i) => {
        const x = (curX / totalW) * width
        const bw = (barW / totalW) * width
        curX += barW
        return i % 2 === 0 ? (
          <rect key={i} x={x} y={0} width={Math.max(0.5, bw - 0.5)} height={height * 0.8} fill="#1a1a1a" />
        ) : null
      })}
      <text
        x={width / 2}
        y={height * 0.98}
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

export function QRPlaceholder({ size }: { size: number }) {
  const cells = [
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
  const cols = cells[0].length
  const cs = size / cols
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <rect width={size} height={size} fill="white" />
      {cells.flatMap((row, ri) =>
        row.map((cell, ci) =>
          cell ? <rect key={`${ri}-${ci}`} x={ci * cs} y={ri * cs} width={cs} height={cs} fill="#111" /> : null
        )
      )}
    </svg>
  )
}

function labelBase(w: number, h: number): React.CSSProperties {
  return {
    width: w,
    height: h,
    position: 'relative',
    overflow: 'hidden',
    background: '#ffffff',
    border: '1px solid #d1d5db',
    borderRadius: 2,
    boxSizing: 'border-box',
    fontFamily: 'Helvetica, Arial, sans-serif',
    flexShrink: 0,
  }
}

export function LabelPreview({
  size,
  product,
  scale,
  showPrice,
}: {
  size: LabelSpec
  product: PreviewProduct | null
  scale: number
  showPrice: boolean
}) {
  const w = Math.round(size.widthPt * scale)
  const h = Math.round(size.heightPt * scale)
  const pad = Math.max(3, Math.round(2.5 * scale))

  const name = product?.name || 'Product Name'
  const variantName = product?.variant_name || null
  const sku = product?.sku || 'SKU-001'
  const brand = product?.brand_name || null
  const gstPct = product?.gst_percentage ?? 0
  const gstFactor = 1 + (gstPct || 0) / 100
  const exGst = product ? (product.price_ex_gst ?? (product.base_price ?? 0) / (gstFactor || 1)) : null
  const mrp = product?.mrp && product.mrp > 0 ? product.mrp / (gstFactor || 1) : null
  const barcodeText = product?.sku || 'SKU-001'

  const barH = Math.round(h * 0.22)
  const nameFontSize = Math.round(8 * scale)
  const smallFontSize = Math.round(5.5 * scale)
  const priceFontSize = Math.round(10 * scale)

  const base = labelBase(w, h)

  if (size.size === '30x20') {
    const nameFs = Math.round(5 * scale)
    const varFs = Math.round(4.5 * scale)
    const qrSize = Math.round(h * 0.32)
    const textRight = qrSize + pad + 2
    return (
      <div style={base}>
        <div style={{ position: 'absolute', top: pad, right: pad }}>
          <QRPlaceholder size={qrSize} />
        </div>
        <div
          style={{
            position: 'absolute',
            top: pad,
            left: pad,
            right: textRight,
            bottom: barH + pad,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              fontSize: nameFs,
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
                fontSize: varFs,
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
          <div style={{ marginTop: 1 }}>
            {showPrice && (
              <PriceBlock exGst={exGst} mrp={mrp} gstPct={gstPct} mainSize={nameFs} subSize={varFs * 0.85} gap={0} />
            )}
          </div>
        </div>
        <div style={{ position: 'absolute', bottom: pad, left: pad, right: pad }}>
          <BarcodePlaceholder width={w - pad * 2} height={barH} text={barcodeText} />
        </div>
      </div>
    )
  }

  if (size.size === '80x20') {
    const nameFs = Math.round(7 * scale)
    const varFs = Math.round(6 * scale)
    const priceFs = Math.round(6.5 * scale)
    const exGstFs = Math.round(4.5 * scale)
    const topH = h - barH - pad
    const qrSize = Math.round(topH * 0.6)
    return (
      <div style={base}>
        <div style={{ position: 'absolute', top: pad, right: pad }}>
          <QRPlaceholder size={qrSize} />
        </div>
        <div
          style={{
            position: 'absolute',
            top: pad,
            left: pad,
            right: qrSize + pad * 2 + 2,
            height: topH - pad,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              fontSize: nameFs,
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
                fontSize: varFs,
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
          {exGst && exGst > 0 && showPrice && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: Math.round(3 * scale), flexWrap: 'wrap' }}>
              {mrp && mrp > 0 && (mrp * (1 + gstPct / 100)).toFixed(2) !== (exGst * (1 + gstPct / 100)).toFixed(2) && (
                <span style={{ fontSize: exGstFs, color: '#aaa', textDecoration: 'line-through' }}>
                  Rs. {(mrp * (1 + gstPct / 100)).toFixed(2)}
                </span>
              )}
              <span style={{ fontSize: priceFs, fontWeight: 700, color: '#c0392b' }}>
                Rs. {(exGst * (1 + gstPct / 100)).toFixed(2)}
              </span>
              {gstPct > 0 && (
                <span style={{ fontSize: exGstFs, color: '#888' }}>ex.GST Rs. {Number(exGst).toFixed(2)}</span>
              )}
            </div>
          )}
        </div>
        <div style={{ position: 'absolute', bottom: pad, left: pad, right: pad }}>
          <BarcodePlaceholder width={w - pad * 2} height={barH} text={barcodeText} />
        </div>
      </div>
    )
  }

  if (size.size === '30x50') {
    const qrSize = Math.round(h * 0.24)
    const textRight = qrSize + pad + 2
    return (
      <div style={base}>
        <div style={{ position: 'absolute', top: pad, right: pad }}>
          <QRPlaceholder size={qrSize} />
        </div>
        <div
          style={{
            position: 'absolute',
            top: pad,
            left: pad,
            right: textRight,
            bottom: barH + pad + 12,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              fontSize: nameFontSize,
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
                fontSize: smallFontSize,
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
          <div style={{ marginTop: 2 }}>
            {showPrice && (
              <PriceBlock
                exGst={exGst}
                mrp={mrp}
                gstPct={gstPct}
                mainSize={priceFontSize * 0.9}
                subSize={smallFontSize * 0.85}
                gap={1}
              />
            )}
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: barH + pad + 1,
            left: pad,
            right: pad,
            fontSize: smallFontSize * 0.85,
            color: '#777',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
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
    return (
      <div style={base}>
        <div style={{ position: 'absolute', top: pad, right: pad }}>
          <QRPlaceholder size={qrSize} />
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
              fontSize: nameFontSize,
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
                fontSize: smallFontSize,
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
          <div style={{ fontSize: smallFontSize * 0.9, color: '#666', marginTop: 2 }}>SKU: {sku}</div>
          <div style={{ marginTop: 3 }}>
            {showPrice && (
              <PriceBlock
                exGst={exGst}
                mrp={mrp}
                gstPct={gstPct}
                mainSize={priceFontSize * 0.9}
                subSize={smallFontSize * 0.85}
                gap={1}
              />
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
    const qrSize = Math.round(w * 0.29)
    const gapAfterQR = Math.round(pad * 0.7)
    const rightX = pad + qrSize + gapAfterQR
    const rightW = w - rightX - pad
    const contentH = h - barH - pad * 2 - 6
    const skuRowH = Math.round(smallFontSize * 0.85) + 3
    const infoH = contentH - skuRowH
    return (
      <div style={base}>
        {/* QR — top left */}
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
          <QRPlaceholder size={qrSize} />
        </div>
        {/* Right column */}
        <div style={{ position: 'absolute', top: pad, left: rightX, width: rightW, height: infoH, overflow: 'hidden' }}>
          <div
            style={{
              fontSize: nameFontSize,
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
                fontSize: smallFontSize,
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
                fontSize: Math.round(smallFontSize * 0.85),
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
          <div style={{ marginTop: 3 }}>
            {showPrice && (
              <PriceBlock
                exGst={exGst}
                mrp={mrp}
                gstPct={gstPct}
                mainSize={priceFontSize}
                subSize={smallFontSize * 0.9}
                gap={1}
              />
            )}
          </div>
        </div>
        {/* SKU row above barcode */}
        <div
          style={{
            position: 'absolute',
            bottom: barH + pad + 1,
            left: pad,
            right: pad,
            fontSize: Math.round(smallFontSize * 0.85),
            color: '#666',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          SKU: {sku}
        </div>
        {/* Barcode */}
        <div style={{ position: 'absolute', bottom: pad, left: pad, right: pad }}>
          <BarcodePlaceholder width={w - pad * 2} height={barH} text={barcodeText} />
        </div>
      </div>
    )
  }

  if (size.size === 'shelf-card') {
    const qrSize = Math.round(w * 0.24)
    const gapAfterQR = Math.round(pad * 0.7)
    const rightX = pad + qrSize + gapAfterQR
    const rightW = w - rightX - pad
    const contentH = h - barH - pad * 2 - 6
    const skuRowH = Math.round(smallFontSize * 0.85) + 3
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
          <QRPlaceholder size={qrSize} />
        </div>
        <div style={{ position: 'absolute', top: pad, left: rightX, width: rightW, height: infoH, overflow: 'hidden' }}>
          <div
            style={{
              fontSize: Math.round(nameFontSize * 1.8),
              fontWeight: 700,
              lineHeight: 1.2,
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
                fontSize: Math.round(smallFontSize * 1.6),
                color: '#333',
                marginTop: 2,
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
                fontSize: Math.round(smallFontSize * 1.3),
                color: '#888',
                marginTop: 2,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
              }}
            >
              {brand}
            </div>
          )}
          <div style={{ marginTop: 5 }}>
            {showPrice && (
              <PriceBlock
                exGst={exGst}
                mrp={mrp}
                gstPct={gstPct}
                mainSize={Math.round(priceFontSize * 1.8)}
                subSize={smallFontSize}
                gap={2}
              />
            )}
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: barH + pad + 1,
            left: pad,
            right: pad,
            fontSize: Math.round(smallFontSize * 1.3),
            color: '#666',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
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

// ── Batch / Serial preview ──────────────────────────────────────────────────
// Mirrors the compact batch/serial PDF renderers: product name on top, then the
// batch (LOT/EXP/QTY) or serial (SKU/S-N) fields, a QR top-right and a barcode at
// the bottom. Used by the Batch/Serial label picker.

export interface BatchPreviewData {
  productName: string
  variantName?: string | null
  sku?: string | null
  lotNumber?: string | null
  expiryDate?: string | null
  quantity?: number | null
}

export interface SerialPreviewData {
  productName: string
  variantName?: string | null
  sku?: string | null
  serialNumber: string
  lotNumber?: string | null
}

export function BatchSerialPreview({
  size,
  mode,
  batch,
  serial,
  scale,
}: {
  size: LabelSpec
  mode: 'batch' | 'serial'
  batch?: BatchPreviewData | null
  serial?: SerialPreviewData | null
  scale: number
}) {
  const w = Math.round(size.widthPt * scale)
  const h = Math.round(size.heightPt * scale)
  const pad = Math.max(3, Math.round(2.5 * scale))
  const barH = Math.round(h * 0.22)
  const qrSize = Math.round(Math.min(w, h) * 0.3)
  const nameFs = Math.round(7.5 * scale)
  const smallFs = Math.round(5.5 * scale)

  const name = mode === 'batch' ? batch?.productName || 'Product Name' : serial?.productName || 'Product Name'
  const variantName = mode === 'batch' ? batch?.variantName : serial?.variantName
  const barcodeText = mode === 'batch' ? batch?.lotNumber || batch?.sku || 'LOT' : serial?.serialNumber || 'S/N'

  const base = labelBase(w, h)

  const lines: { label: string; value: string; bold?: boolean }[] = []
  if (mode === 'batch') {
    if (batch?.lotNumber) lines.push({ label: 'LOT', value: batch.lotNumber })
    if (batch?.expiryDate) lines.push({ label: 'EXP', value: batch.expiryDate })
    if (batch?.quantity != null) lines.push({ label: 'QTY', value: String(batch.quantity) })
  } else {
    if (serial?.sku) lines.push({ label: 'SKU', value: serial.sku })
    if (serial?.lotNumber) lines.push({ label: 'LOT', value: serial.lotNumber })
    lines.push({ label: 'S/N', value: serial?.serialNumber || '—', bold: true })
  }

  return (
    <div style={base}>
      <div style={{ position: 'absolute', top: pad, right: pad }}>
        <QRPlaceholder size={qrSize} />
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
            lineHeight: 1.2,
            color: '#111',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as any,
          }}
        >
          {name}
        </div>
        {variantName && (
          <div
            style={{
              fontSize: smallFs,
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
        <div style={{ marginTop: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {lines.map((l, i) => (
            <div
              key={i}
              style={{
                fontSize: smallFs,
                color: l.bold ? '#111' : '#444',
                fontWeight: l.bold ? 700 : 400,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
              }}
            >
              {l.label}: {l.value}
            </div>
          ))}
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: pad, left: pad, right: pad }}>
        <BarcodePlaceholder width={w - pad * 2} height={barH} text={barcodeText} />
      </div>
    </div>
  )
}
