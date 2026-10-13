import { Page, View, Text } from '@react-pdf/renderer'
import { Doc, ItemsTable, TotalsBlock, PartyBlock, Logo, Meta, NotesTerms, Stamp, LabelPage, Footer, onColor, A4, pageStyle } from '../kit.js'
import type { Design } from '../types.js'

// Dense, boxed, GST-compliant: every block in a ruled cell, amount in words and signatory box.
export const grid: Design = {
  key: 'grid', name: 'Grid', description: 'Dense boxed GST layout — ruled cells, HSN and tax per line, signatory box.',
  accent: '#1e3a8a', font: 'technical', palette: { ink: '#0f172a', muted: '#475569', rule: '#94a3b8' },
  render: (m, t) => {
    const cell = { borderWidth: 0.8, borderColor: t.rule, padding: 8 }
    if (m.type === 'label') return <Doc m={m}><LabelPage m={m} t={t} header={<View style={{ ...cell, flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontWeight: 700, fontSize: 10 }}>{m.seller.name}</Text><Text style={{ fontFamily: t.mono, fontSize: 9 }}>{m.number}</Text></View>} /></Doc>
    return (
      <Doc m={m}>
        <Page size={A4} style={pageStyle(t, { paddingHorizontal: 32, fontSize: 8.5 })}>
          <View style={{ ...cell, backgroundColor: t.accent, alignItems: 'center', paddingVertical: 6 }}>
            <Text style={{ color: onColor(t.accent), fontWeight: 700, fontSize: 12, letterSpacing: 3, textTransform: 'uppercase' }}>{m.title}</Text>
          </View>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ ...cell, flex: 3, borderTopWidth: 0 }}>
              <Logo m={m} height={24} />
              <PartyBlock label={m.labels.from} p={m.seller} t={t} size={8} />
            </View>
            <View style={{ ...cell, flex: 2, borderTopWidth: 0, borderLeftWidth: 0 }}><Meta m={m} t={t} /></View>
          </View>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ ...cell, flex: 1, borderTopWidth: 0 }}><PartyBlock label={m.labels.to} p={m.buyer} t={t} size={8} /></View>
            <View style={{ ...cell, flex: 1, borderTopWidth: 0, borderLeftWidth: 0 }}>{m.shipTo ? <PartyBlock label={m.labels.ship} p={m.shipTo} t={t} size={8} /> : <PartyBlock label={m.labels.ship} p={m.buyer} t={t} size={8} />}</View>
          </View>
          <ItemsTable m={m} t={t} variant="boxed" size={8} />
          {m.showPrices && (
            <View wrap={false} style={{ flexDirection: 'row', marginTop: 0 }}>
              <View style={{ ...cell, flex: 1, borderTopWidth: 0 }}>
                <Text style={{ fontSize: 7, color: t.muted, textTransform: 'uppercase', letterSpacing: 1 }}>Amount in words</Text>
                <Text style={{ fontSize: 8.5, fontWeight: 600, marginTop: 3 }}>{m.amountWords}</Text>
              </View>
              <View style={{ ...cell, width: 230, borderTopWidth: 0, borderLeftWidth: 0, padding: 0, paddingHorizontal: 8 }}><TotalsBlock m={m} t={t} variant="lined" width={214} /></View>
            </View>
          )}
          <NotesTerms m={m} t={t} />
          <View wrap={false} style={{ marginTop: 22, marginLeft: 'auto', width: 200, alignItems: 'center' }}>
            <View style={{ height: 36 }} />
            <View style={{ borderTopWidth: 0.8, borderTopColor: t.ink, width: '100%', paddingTop: 4, alignItems: 'center' }}>
              <Text style={{ fontSize: 8 }}>For {m.seller.name}</Text>
              <Text style={{ fontSize: 7, color: t.muted }}>Authorised signatory</Text>
            </View>
          </View>
          <Stamp m={m} t={t} />
          <Footer m={m} t={t} />
        </Page>
      </Doc>
    )
  },
}
