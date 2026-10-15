import { Page, View, Text, Image } from '@react-pdf/renderer'
import { Doc, Body, Footer, Logo, Meta, Stamp, LabelPage, A4 } from '../kit.js'
import { money } from '../model.js'
import type { DocModel } from '../model.js'
import type { Theme } from '../kit.js'
import type { Design } from '../types.js'

// Space-efficient A5; `thermal` (legacy thermal-80mm) gives an 80 mm roll receipt.
function Thermal({ m, t }: { m: DocModel; t: Theme }) {
  const W = 226.77
  const h = 300 + m.lines.length * 26 + (m.notes ? 40 : 0) + (m.totals.charges.length + 4) * 12
  const row = (a: string, b: string, bold = false) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
      <Text style={{ fontSize: bold ? 9 : 7.5, fontWeight: bold ? 700 : 400 }}>{a}</Text>
      <Text style={{ fontSize: bold ? 9 : 7.5, fontWeight: bold ? 700 : 400 }}>{b}</Text>
    </View>
  )
  const dash = <View style={{ borderBottomWidth: 0.8, borderStyle: 'dashed', borderBottomColor: '#000', marginVertical: 6 }} />
  return (
    <Page size={[W, h]} style={{ padding: 10, fontFamily: t.body, color: '#000' }}>
      <View style={{ alignItems: 'center' }}>
        <Logo m={m} height={26} />
        <Text style={{ fontWeight: 700, fontSize: 10, marginTop: 2 }}>{m.seller.name}</Text>
        {m.seller.gstin && <Text style={{ fontFamily: t.mono, fontSize: 6.5 }}>GSTIN {m.seller.gstin}</Text>}
        <Text style={{ fontSize: 7.5, marginTop: 2 }}>{m.title} · {m.number}</Text>
        <Text style={{ fontSize: 7 }}>{m.date}</Text>
      </View>
      {dash}
      {m.lines.map((l, i) => (
        <View key={i} style={{ marginBottom: 3 }}>
          <Text style={{ fontSize: 7.5 }}>{l.description}</Text>
          {m.showPrices && row(`${l.quantity} × ${money(l.rate)}`, money(l.total))}
        </View>
      ))}
      {m.showPrices && <>
        {dash}{row('Subtotal', money(m.totals.subtotal))}
        {m.totals.discount > 0 && row('Discount', `-${money(m.totals.discount)}`)}
        {m.totals.charges.map(ch => <View key={ch.label}>{row(ch.label, money(ch.amount))}</View>)}
        {m.totals.is_igst ? row('IGST', money(m.totals.igst)) : <>{row('CGST', money(m.totals.cgst))}{row('SGST', money(m.totals.sgst))}</>}
        {m.totals.round_off !== 0 && row('Round off', money(m.totals.round_off))}
        {row(m.type === 'receipt' ? 'PAID' : 'TOTAL', money(m.totals.total), true)}
        {m.type !== 'receipt' && m.totals.amount_paid > 0 && <>{row('Paid', `-${money(m.totals.amount_paid)}`)}{row('BALANCE DUE', money(m.totals.balance_due), true)}</>}
      </>}
      {dash}
      <View style={{ alignItems: 'center' }}>
        <Image src={m.qr} style={{ width: 56, height: 56 }} />
        <Text style={{ fontSize: 6.5, marginTop: 3 }}>{m.notes ?? 'Thank you!'}</Text>
      </View>
    </Page>
  )
}

export const compact: Design = {
  key: 'compact', name: 'Compact', description: 'Space-efficient A5 sheet; 80 mm thermal roll for receipts.',
  accent: '#374151', font: 'system',
  render: (m, t, { thermal }) => {
    if (m.type === 'label') return <Doc m={m}><LabelPage m={m} t={t} header={<Text style={{ fontWeight: 700, fontSize: 10 }}>{m.seller.name} · {m.number}</Text>} /></Doc>
    if (thermal) return <Doc m={m}><Thermal m={m} t={t} /></Doc>
    return (
      <Doc m={m}>
        <Page size="A5" style={{ paddingTop: 24, paddingBottom: 54, paddingHorizontal: 24, fontFamily: t.body, color: t.ink, fontSize: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: 1.5, borderBottomColor: t.accent, paddingBottom: 8 }}>
            <View>
              <Logo m={m} height={20} fallback={<Text style={{ fontWeight: 700, fontSize: 11 }}>{m.seller.name}</Text>} />
              <Text style={{ fontWeight: 700, fontSize: 13, marginTop: 4, color: t.accent }}>{m.title}</Text>
            </View>
            <Meta m={m} t={t} align="right" />
          </View>
          <Body m={m} t={t} table="lined" totals="lined" size={7.5} />
          <Stamp m={m} t={t} />
          <Footer m={m} t={t} />
        </Page>
      </Doc>
    )
  },
}
