import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import type { ReactNode } from 'react'
import type { DocModel, LineView, PartyView } from './model.js'
import { money } from './model.js'
import { FONT_PAIRINGS } from './fonts.js'
import type { FontKey } from './model.js'

// Design-agnostic building blocks. A design chooses a Theme and arranges these (plus its own header).

export interface Theme {
  accent: string
  ink: string
  muted: string
  rule: string
  soft: string // light tint of the accent
  head: string
  body: string
  mono: string
}

const hex = (h: string) => {
  const s = h.replace('#', '')
  const v = s.length === 3 ? s.split('').map(c => c + c).join('') : s
  return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16))
}
/** Mix a colour with white: t=0 → colour, t=1 → white. */
export const tint = (h: string, t: number) => '#' + hex(h).map(c => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0')).join('')
/** Readable text colour on a background. */
export const onColor = (h: string) => {
  const [r, g, b] = hex(h)
  return r * 0.299 + g * 0.587 + b * 0.114 > 160 ? '#111111' : '#ffffff'
}

export function theme(accent: string, font: FontKey, over: Partial<Theme> = {}): Theme {
  const p = FONT_PAIRINGS[font] ?? FONT_PAIRINGS.modern
  return { accent, ink: '#16181d', muted: '#6b7280', rule: '#e5e7eb', soft: tint(accent, 0.9), head: p.head, body: p.body, mono: p.mono, ...over }
}

export const A4 = 'A4' as const
export const LABEL_SIZE: [number, number] = [288, 432] // 4 × 6 in

export function Doc({ m, children }: { m: DocModel; children: ReactNode }) {
  return <Document title={`${m.title} ${m.number}`} author={m.seller.name} creator="Jeffi Commerce" producer="Jeffi Commerce">{children}</Document>
}

// `plate`: a light backing so any logo stays legible on a coloured header.
export function Logo({ m, height = 34, fallback, plate }: { m: DocModel; height?: number; fallback?: ReactNode; plate?: boolean }) {
  const img = m.logo ? <Image src={{ data: m.logo, format: 'png' }} style={{ height, objectFit: 'contain', maxWidth: height * 4 }} /> : null
  if (img && plate) return <View style={{ backgroundColor: '#ffffff', borderRadius: 4, padding: 5, alignSelf: 'flex-start' }}>{img}</View>
  if (img) return img
  return <>{fallback ?? null}</>
}

export function PartyBlock({ label, p, t, align = 'left', size = 9 }: { label: string; p?: PartyView; t: Theme; align?: 'left' | 'right'; size?: number }) {
  if (!p) return null
  return (
    <View style={{ textAlign: align }}>
      <Text style={{ fontFamily: t.body, fontSize: 7, letterSpacing: 1.2, color: t.muted, textTransform: 'uppercase', marginBottom: 4 }}>{label}</Text>
      <Text style={{ fontFamily: t.body, fontWeight: 700, fontSize: size + 1.5, color: t.ink, marginBottom: 2 }}>{p.name}</Text>
      {p.lines.map((l, i) => <Text key={i} style={{ fontFamily: t.body, fontSize: size, color: t.muted, lineHeight: 1.45 }}>{l}</Text>)}
      {p.gstin && <Text style={{ fontFamily: t.mono, fontSize: size - 0.5, color: t.ink, marginTop: 3 }}>GSTIN {p.gstin}</Text>}
    </View>
  )
}

export function MetaRow({ label, value, t, align = 'left' }: { label: string; value?: string; t: Theme; align?: 'left' | 'right' }) {
  if (!value) return null
  return (
    <View style={{ flexDirection: 'row', justifyContent: align === 'right' ? 'flex-end' : 'flex-start', marginBottom: 2 }}>
      <Text style={{ fontFamily: t.body, fontSize: 8, color: t.muted, width: 62, textAlign: align === 'right' ? 'right' : 'left', marginRight: 6 }}>{label}</Text>
      <Text style={{ fontFamily: t.body, fontSize: 8.5, color: t.ink, fontWeight: 600 }}>{value}</Text>
    </View>
  )
}

/** Number / date / due / reference block. */
export function Meta({ m, t, align = 'left' }: { m: DocModel; t: Theme; align?: 'left' | 'right' }) {
  return (
    <View>
      <MetaRow label="Number" value={m.number} t={t} align={align} />
      <MetaRow label="Date" value={m.date} t={t} align={align} />
      {m.due && <MetaRow label={m.due.label} value={m.due.date} t={t} align={align} />}
      <MetaRow label="Reference" value={m.reference} t={t} align={align} />
    </View>
  )
}

type Col = { key: string; label: string; w: number; align: 'left' | 'right' | 'center'; get: (l: LineView, i: number) => string }

function columns(m: DocModel): Col[] {
  const idx: Col = { key: 'i', label: '#', w: 0.05, align: 'left', get: (_l, i) => String(i + 1) }
  const desc = (w: number): Col => ({ key: 'd', label: 'Item', w, align: 'left', get: l => l.description })
  const qty: Col = { key: 'q', label: 'Qty', w: 0.08, align: 'right', get: l => `${l.quantity}${l.unit ? ' ' + l.unit : ''}` }
  if (!m.showPrices) {
    return [idx, desc(0.55), { key: 'h', label: 'HSN', w: 0.14, align: 'left', get: l => l.hsn ?? '—' }, { ...qty, w: 0.14 },
      { key: 'c', label: 'Packed', w: 0.12, align: 'center', get: () => '' }]
  }
  return [idx, desc(m.showTax ? 0.33 : 0.5), { key: 'h', label: 'HSN', w: 0.1, align: 'left', get: l => l.hsn ?? '—' }, qty,
    { key: 'r', label: 'Rate', w: 0.12, align: 'right', get: l => money(l.rate) },
    ...(m.showTax ? [{ key: 'g', label: 'GST', w: 0.08, align: 'right', get: (l: LineView) => `${l.gstRate}%` } as Col,
      { key: 't', label: 'Taxable', w: 0.12, align: 'right', get: (l: LineView) => money(l.taxable) } as Col] : []),
    { key: 'a', label: 'Amount', w: 0.12, align: 'right', get: l => money(l.total) }]
}

export type TableStyle = 'lined' | 'boxed' | 'striped' | 'plain' | 'band'

export function ItemsTable({ m, t, variant = 'lined', size = 8.5, headBg, headColor }: {
  m: DocModel; t: Theme; variant?: TableStyle; size?: number; headBg?: string; headColor?: string
}) {
  const cols = columns(m)
  const boxed = variant === 'boxed'
  const cell = (c: Col, last: boolean) => ({
    width: `${c.w * 100}%`, textAlign: c.align, paddingVertical: 5, paddingHorizontal: 5,
    ...(boxed && !last ? { borderRightWidth: 0.6, borderRightColor: t.rule } : {}),
  })
  const bg = headBg ?? (variant === 'band' ? t.accent : variant === 'plain' ? 'transparent' : t.soft)
  const fg = headColor ?? (variant === 'band' ? onColor(t.accent) : t.ink)
  return (
    <View style={{ marginTop: 14, ...(boxed ? { borderWidth: 0.6, borderColor: t.rule } : {}) }}>
      <View fixed style={{ flexDirection: 'row', backgroundColor: bg, ...(variant === 'plain' ? { borderBottomWidth: 1.2, borderBottomColor: t.ink } : {}), ...(variant === 'band' ? { borderRadius: 3 } : {}) }}>
        {cols.map((c, i) => (
          <Text key={c.key} style={{ ...cell(c, i === cols.length - 1), fontFamily: t.body, fontWeight: 700, fontSize: size - 1.5, letterSpacing: 0.6, color: fg, textTransform: 'uppercase' }}>{c.label}</Text>
        ))}
      </View>
      {m.lines.map((l, r) => (
        <View key={r} wrap={false} style={{
          flexDirection: 'row',
          backgroundColor: variant === 'striped' && r % 2 === 1 ? tint(t.accent, 0.95) : 'transparent',
          ...(variant !== 'striped' ? { borderBottomWidth: 0.6, borderBottomColor: t.rule } : {}),
        }}>
          {cols.map((c, i) => c.key === 'c' ? (
            <View key={c.key} style={{ ...cell(c, i === cols.length - 1), alignItems: 'center' }}><View style={{ width: 9, height: 9, borderWidth: 0.9, borderColor: t.ink, borderRadius: 1.5 }} /></View>
          ) : (
            <Text key={c.key} style={{ ...cell(c, i === cols.length - 1), fontFamily: c.key === 'h' ? t.mono : t.body, fontSize: c.key === 'h' ? size - 1 : size, color: t.ink, fontWeight: c.key === 'a' ? 600 : 400 }}>{c.get(l, r)}</Text>
          ))}
        </View>
      ))}
    </View>
  )
}

function TotalRow({ label, value, t, strong, color }: { label: string; value: string; t: Theme; strong?: boolean; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: strong ? 6 : 2.5 }}>
      <Text style={{ fontFamily: t.body, fontSize: strong ? 10 : 8.5, color: color ?? (strong ? t.ink : t.muted), fontWeight: strong ? 700 : 400 }}>{label}</Text>
      <Text style={{ fontFamily: t.body, fontSize: strong ? 12 : 8.5, color: color ?? t.ink, fontWeight: strong ? 700 : 600 }}>{value}</Text>
    </View>
  )
}

export function TotalsBlock({ m, t, variant = 'lined', width = 220 }: { m: DocModel; t: Theme; variant?: 'lined' | 'card' | 'band' | 'boxed'; width?: number }) {
  if (!m.showPrices) return null
  const x = m.totals
  const grand = variant === 'band'
  return (
    <View wrap={false} style={{
      width, marginTop: 12, marginLeft: 'auto',
      ...(variant === 'card' ? { backgroundColor: t.soft, borderRadius: 8, padding: 12 } : {}),
      ...(variant === 'boxed' ? { borderWidth: 0.8, borderColor: t.rule, padding: 8 } : {}),
    }}>
      <TotalRow label="Subtotal" value={money(x.subtotal)} t={t} />
      {x.discount > 0 && <TotalRow label="Discount" value={`− ${money(x.discount)}`} t={t} />}
      {m.showTax && <TotalRow label="Taxable value" value={money(x.taxable)} t={t} />}
      {m.showTax && (x.is_igst
        ? <TotalRow label="IGST" value={money(x.igst)} t={t} />
        : <><TotalRow label="CGST" value={money(x.cgst)} t={t} /><TotalRow label="SGST" value={money(x.sgst)} t={t} /></>)}
      <View style={{ marginTop: 4, ...(grand ? { backgroundColor: t.accent, borderRadius: 4, paddingHorizontal: 8 } : { borderTopWidth: 1, borderTopColor: variant === 'card' ? t.accent : t.ink }) }}>
        <TotalRow label={m.type === 'receipt' ? 'Amount paid' : 'Total'} value={money(x.total)} t={t} strong color={grand ? onColor(t.accent) : undefined} />
      </View>
    </View>
  )
}

export function AmountWords({ m, t }: { m: DocModel; t: Theme }) {
  if (!m.showPrices) return null
  return <Text style={{ fontFamily: t.body, fontSize: 7.5, color: t.muted, marginTop: 8, fontStyle: 'normal' }}>{m.amountWords}</Text>
}

export function NotesTerms({ m, t }: { m: DocModel; t: Theme }) {
  if (!m.notes && !m.terms) return null
  const block = (label: string, body?: string) => body ? (
    <View style={{ flex: 1 }}>
      <Text style={{ fontFamily: t.body, fontSize: 7, letterSpacing: 1.2, textTransform: 'uppercase', color: t.muted, marginBottom: 3 }}>{label}</Text>
      <Text style={{ fontFamily: t.body, fontSize: 8, color: t.ink, lineHeight: 1.5 }}>{body}</Text>
    </View>
  ) : null
  return (
    <View wrap={false} style={{ flexDirection: 'row', gap: 20, marginTop: 18 }}>
      {block('Notes', m.notes)}
      {block('Terms', m.terms)}
    </View>
  )
}

/** Bottom of every page: QR to the online copy, link, page x / y. */
export function Footer({ m, t, color }: { m: DocModel; t: Theme; color?: string }) {
  return (
    <View fixed style={{ position: 'absolute', bottom: 22, left: 40, right: 40, flexDirection: 'row', alignItems: 'center', borderTopWidth: 0.6, borderTopColor: t.rule, paddingTop: 8 }}>
      <Image src={m.qr} style={{ width: 30, height: 30, marginRight: 8 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: t.body, fontSize: 7, color: color ?? t.muted }}>Scan or open to view this {m.title.toLowerCase()} online</Text>
        <Text style={{ fontFamily: t.mono, fontSize: 6.5, color: color ?? t.muted }}>{m.viewUrl}</Text>
      </View>
      <Text style={{ fontFamily: t.body, fontSize: 7, color: color ?? t.muted }} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  )
}

export function Stamp({ m, t }: { m: DocModel; t: Theme }) {
  if (!m.stamp) return null
  return (
    <View style={{ position: 'absolute', top: 150, right: 60, transform: 'rotate(-14deg)', borderWidth: 2.5, borderColor: t.accent, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 14, opacity: 0.85 }}>
      <Text style={{ fontFamily: t.head, fontWeight: 700, fontSize: 22, letterSpacing: 4, color: t.accent }}>{m.stamp}</Text>
    </View>
  )
}

/** 4×6 in shipping label; designs pass their own header band. */
export function LabelPage({ m, t, header }: { m: DocModel; t: Theme; header: ReactNode }) {
  const to = m.shipTo ?? m.buyer
  return (
    <Page size={LABEL_SIZE} style={{ padding: 14, fontFamily: t.body, color: t.ink }}>
      {header}
      <View style={{ marginTop: 10, borderWidth: 1.5, borderColor: t.ink, borderRadius: 4, padding: 10 }}>
        <Text style={{ fontSize: 7, letterSpacing: 1.4, textTransform: 'uppercase', color: t.muted }}>Deliver to</Text>
        <Text style={{ fontFamily: t.head, fontWeight: 700, fontSize: 16, marginTop: 3 }}>{to.name}</Text>
        {to.lines.map((l, i) => <Text key={i} style={{ fontSize: 10, lineHeight: 1.4 }}>{l}</Text>)}
      </View>
      <View style={{ marginTop: 10, flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 6.5, letterSpacing: 1.2, textTransform: 'uppercase', color: t.muted }}>From</Text>
          <Text style={{ fontSize: 8.5, fontWeight: 700, marginTop: 2 }}>{m.seller.name}</Text>
          {m.seller.lines.slice(0, 3).map((l, i) => <Text key={i} style={{ fontSize: 7.5, color: t.muted }}>{l}</Text>)}
        </View>
        <Image src={m.qr} style={{ width: 62, height: 62 }} />
      </View>
      <View style={{ marginTop: 'auto', borderTopWidth: 1, borderTopColor: t.rule, paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ fontSize: 6.5, color: t.muted, textTransform: 'uppercase', letterSpacing: 1 }}>Order</Text>
          <Text style={{ fontFamily: t.mono, fontSize: 11, fontWeight: 700 }}>{m.reference ?? m.number}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 6.5, color: t.muted, textTransform: 'uppercase', letterSpacing: 1 }}>Items</Text>
          <Text style={{ fontSize: 11, fontWeight: 700 }}>{m.lines.reduce((s, l) => s + l.quantity, 0)}</Text>
        </View>
      </View>
    </Page>
  )
}

/** Standard body after the header: parties → items → totals → words → notes. */
export function Body({ m, t, table = 'lined', totals = 'lined', partiesBox, size = 9 }: {
  m: DocModel; t: Theme; table?: TableStyle; totals?: 'lined' | 'card' | 'band' | 'boxed'; partiesBox?: boolean; size?: number
}) {
  const box = partiesBox ? { backgroundColor: t.soft, borderRadius: 6, padding: 10 } : {}
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 16, marginTop: size < 9 ? 12 : 18 }}>
        <View style={{ flex: 1, ...box }}><PartyBlock label={m.labels.from} p={m.seller} t={t} size={size} /></View>
        <View style={{ flex: 1, ...box }}><PartyBlock label={m.labels.to} p={m.buyer} t={t} size={size} /></View>
        {m.shipTo && <View style={{ flex: 1, ...box }}><PartyBlock label={m.labels.ship} p={m.shipTo} t={t} size={size} /></View>}
      </View>
      <ItemsTable m={m} t={t} variant={table} size={size - 0.5} />
      <TotalsBlock m={m} t={t} variant={totals} />
      <AmountWords m={m} t={t} />
      <NotesTerms m={m} t={t} />
    </>
  )
}

export const pageStyle = (t: Theme, extra: object = {}) => ({ paddingTop: 40, paddingBottom: 70, paddingHorizontal: 40, fontFamily: t.body, color: t.ink, fontSize: 9, ...extra })
