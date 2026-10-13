import { Page, View, Text } from '@react-pdf/renderer'
import { Doc, Body, Footer, Logo, Stamp, LabelPage, tint, onColor, A4, pageStyle } from '../kit.js'
import type { Design } from '../types.js'

// Soft and friendly: centred logo, title pill, rounded pastel cards, thank-you line.
export const boutique: Design = {
  key: 'boutique', name: 'Boutique', description: 'Soft and friendly — centred logo, rounded pastel cards, thank-you note.',
  accent: '#db2777', font: 'geometric', palette: { ink: '#3f3a44', muted: '#8b8394', rule: '#f1e8ef' },
  render: (m, t) => {
    if (m.type === 'label') return <Doc m={m}><LabelPage m={m} t={t} header={<View style={{ alignItems: 'center', backgroundColor: t.soft, borderRadius: 12, padding: 6 }}><Text style={{ color: t.accent, fontWeight: 700, fontSize: 11 }}>{m.seller.name}</Text></View>} /></Doc>
    return (
      <Doc m={m}>
        <Page size={A4} style={pageStyle(t, { backgroundColor: tint(t.accent, 0.975) })}>
          <View style={{ alignItems: 'center' }}>
            <Logo m={m} height={34} fallback={<Text style={{ fontFamily: t.head, fontWeight: 700, fontSize: 16, color: t.accent }}>{m.seller.name}</Text>} />
            <View style={{ marginTop: 12, backgroundColor: t.accent, borderRadius: 20, paddingVertical: 5, paddingHorizontal: 16 }}>
              <Text style={{ color: onColor(t.accent), fontWeight: 700, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase' }}>{m.title}</Text>
            </View>
            <Text style={{ fontSize: 9, color: t.muted, marginTop: 8 }}>{m.number}  ·  {m.date}{m.due ? `  ·  ${m.due.label} ${m.due.date}` : ''}</Text>
          </View>
          <Body m={m} t={t} table="striped" totals="card" partiesBox />
          <Text style={{ textAlign: 'center', fontFamily: t.head, fontSize: 11, color: t.accent, marginTop: 22 }}>Thank you for shopping with {m.seller.name}!</Text>
          <Stamp m={m} t={t} />
          <Footer m={m} t={t} />
        </Page>
      </Doc>
    )
  },
}
