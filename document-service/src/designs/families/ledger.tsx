import { Page, View, Text } from '@react-pdf/renderer'
import { Doc, Body, Footer, Logo, Meta, Stamp, LabelPage, A4, pageStyle } from '../kit.js'
import type { Design } from '../types.js'

// Classic accounting: seller masthead, double rule, ruled table, serif headings.
export const ledger: Design = {
  key: 'ledger', name: 'Ledger', description: 'Classic accounting style — serif masthead, double rule, ruled table.',
  accent: '#7c2d12', font: 'classic', palette: { ink: '#1c1917', muted: '#78716c', rule: '#d6d3d1' },
  render: (m, t) => {
    const double = (
      <View style={{ marginTop: 12 }}>
        <View style={{ borderBottomWidth: 1.6, borderBottomColor: t.ink }} />
        <View style={{ borderBottomWidth: 0.5, borderBottomColor: t.ink, marginTop: 2 }} />
      </View>
    )
    if (m.type === 'label') return <Doc m={m}><LabelPage m={m} t={t} header={<View><Text style={{ fontFamily: t.head, fontWeight: 700, fontSize: 13 }}>{m.seller.name}</Text>{double}</View>} /></Doc>
    return (
      <Doc m={m}>
        <Page size={A4} style={pageStyle(t)}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ maxWidth: '60%' }}>
              <Logo m={m} height={28} />
              <Text style={{ fontFamily: t.head, fontWeight: 700, fontSize: 20, marginTop: m.logo ? 8 : 0 }}>{m.seller.name}</Text>
              <Text style={{ fontSize: 8, color: t.muted, marginTop: 2 }}>{m.seller.lines.join('  ·  ')}</Text>
              {m.seller.gstin && <Text style={{ fontFamily: t.mono, fontSize: 8, marginTop: 2 }}>GSTIN {m.seller.gstin}</Text>}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: t.head, fontSize: 15, letterSpacing: 3, color: t.accent, textTransform: 'uppercase' }}>{m.title}</Text>
              <View style={{ marginTop: 6 }}><Meta m={m} t={t} align="right" /></View>
            </View>
          </View>
          {double}
          <Body m={{ ...m, seller: { ...m.seller, lines: [], gstin: undefined } }} t={t} table="plain" totals="lined" />
          <Stamp m={m} t={t} />
          <Footer m={m} t={t} />
        </Page>
      </Doc>
    )
  },
}
