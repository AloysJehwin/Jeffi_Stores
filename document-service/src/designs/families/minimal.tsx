import { Page, View, Text } from '@react-pdf/renderer'
import { Doc, Body, Footer, Logo, Stamp, LabelPage, A4, pageStyle } from '../kit.js'
import type { Design } from '../types.js'

// Whitespace and hairlines; the accent only marks the total.
export const minimal: Design = {
  key: 'minimal', name: 'Minimal', description: 'Quiet and airy — hairline rules, lots of whitespace, accent only on the total.',
  accent: '#111827', font: 'modern', palette: { rule: '#f0f0f0', muted: '#9ca3af' },
  render: (m, t) => {
    if (m.type === 'label') return <Doc m={m}><LabelPage m={m} t={t} header={<Text style={{ fontSize: 7, letterSpacing: 2, color: t.muted, textTransform: 'uppercase' }}>{m.seller.name}</Text>} /></Doc>
    return (
      <Doc m={m}>
        <Page size={A4} style={pageStyle(t, { paddingHorizontal: 56, paddingTop: 56 })}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Logo m={m} height={22} fallback={<Text style={{ fontSize: 10, fontWeight: 600 }}>{m.seller.name}</Text>} />
            <Text style={{ fontSize: 7, letterSpacing: 2.5, color: t.muted, textTransform: 'uppercase' }}>{m.title}</Text>
          </View>
          <Text style={{ fontFamily: t.head, fontSize: 30, fontWeight: 400, marginTop: 36, letterSpacing: -0.5 }}>{m.number}</Text>
          <Text style={{ fontSize: 8.5, color: t.muted, marginTop: 4 }}>{m.date}{m.due ? `   ${m.due.label} ${m.due.date}` : ''}{m.reference ? `   Ref ${m.reference}` : ''}</Text>
          <Body m={m} t={t} table="lined" totals="lined" />
          <Stamp m={m} t={t} />
          <Footer m={m} t={t} />
        </Page>
      </Doc>
    )
  },
}
