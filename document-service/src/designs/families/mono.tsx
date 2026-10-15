import { Page, View, Text } from '@react-pdf/renderer'
import { Doc, Body, Footer, Logo, Stamp, LabelPage, A4, pageStyle } from '../kit.js'
import type { Design } from '../types.js'

// Technical: monospace headings, dashed rules, terminal-style title line.
export const mono: Design = {
  key: 'mono', name: 'Mono', description: 'Technical, receipt-like — monospace headings and dashed rules.',
  accent: '#16a34a', font: 'technical', palette: { ink: '#111111', muted: '#6b6b6b', rule: '#d4d4d4' },
  render: (m, t) => {
    const dash = <View style={{ borderBottomWidth: 1, borderBottomColor: t.ink, borderStyle: 'dashed', marginVertical: 10 }} />
    if (m.type === 'label') return <Doc m={m}><LabelPage m={m} t={t} header={<Text style={{ fontFamily: t.mono, fontWeight: 700, fontSize: 10 }}>{`> ${m.seller.name}`}</Text>} /></Doc>
    return (
      <Doc m={m}>
        <Page size={A4} style={pageStyle(t)}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Logo m={m} height={22} fallback={<Text style={{ fontFamily: t.mono, fontWeight: 700, fontSize: 11 }}>{m.seller.name}</Text>} />
            <Text style={{ fontFamily: t.mono, fontSize: 8, color: t.muted }}>{m.date}</Text>
          </View>
          {dash}
          <Text style={{ fontFamily: t.mono, fontWeight: 700, fontSize: 18 }}>
            <Text style={{ color: t.accent }}>{m.title.toUpperCase().replace(/ /g, '_')}</Text>{` // ${m.number}`}
          </Text>
          <Text style={{ fontFamily: t.mono, fontSize: 8, color: t.muted, marginTop: 4 }}>
            {[m.due && `${m.due.label.toLowerCase()}=${m.due.date}`, m.reference && `ref=${m.reference}`].filter(Boolean).join('  ')}
          </Text>
          {dash}
          <Body m={m} t={t} table="lined" totals="lined" />
          <Stamp m={m} t={t} />
          <Footer m={m} t={t} />
        </Page>
      </Doc>
    )
  },
}
