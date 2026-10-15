import { Page, View, Text } from '@react-pdf/renderer'
import { Doc, Body, Footer, Logo, Meta, Stamp, LabelPage, onColor, A4, pageStyle } from '../kit.js'
import type { Design } from '../types.js'

// Full-bleed accent header with the logo, soft card totals.
export const aurora: Design = {
  key: 'aurora', name: 'Aurora', description: 'Full-width colour header with your logo and a soft totals card.',
  accent: '#4f46e5', font: 'modern',
  render: (m, t) => {
    const fg = onColor(t.accent)
    const header = (
      <View style={{ backgroundColor: t.accent, marginHorizontal: -40, marginTop: -40, paddingHorizontal: 40, paddingTop: 34, paddingBottom: 26, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <View>
          <Logo m={m} height={30} plate fallback={<Text style={{ fontFamily: t.head, fontWeight: 700, fontSize: 15, color: fg }}>{m.seller.name}</Text>} />
          <Text style={{ fontFamily: t.head, fontWeight: 700, fontSize: 26, color: fg, marginTop: 12 }}>{m.title}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 8, color: fg, opacity: 0.8 }}>No.</Text>
          <Text style={{ fontFamily: t.mono, fontSize: 13, color: fg, fontWeight: 700 }}>{m.number}</Text>
          <Text style={{ fontSize: 8.5, color: fg, marginTop: 4 }}>{m.date}{m.due ? `  ·  ${m.due.label} ${m.due.date}` : ''}</Text>
        </View>
      </View>
    )
    if (m.type === 'label') return <Doc m={m}><LabelPage m={m} t={t} header={<View style={{ backgroundColor: t.accent, borderRadius: 4, padding: 8 }}><Text style={{ color: fg, fontFamily: t.head, fontWeight: 700, fontSize: 11 }}>{m.seller.name}</Text></View>} /></Doc>
    return (
      <Doc m={m}>
        <Page size={A4} style={pageStyle(t)}>
          {header}
          {m.reference && <View style={{ marginTop: 10 }}><Meta m={{ ...m, number: '', date: '', due: undefined }} t={t} /></View>}
          <Body m={m} t={t} table="striped" totals="card" />
          <Stamp m={m} t={t} />
          <Footer m={m} t={t} />
        </Page>
      </Doc>
    )
  },
}
