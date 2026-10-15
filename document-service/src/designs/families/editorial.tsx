import { Page, View, Text } from '@react-pdf/renderer'
import { Doc, Body, Footer, Logo, Stamp, LabelPage, A4, pageStyle } from '../kit.js'
import type { Design } from '../types.js'

// Magazine rhythm: oversized serif title, accent rule, meta in columns.
export const editorial: Design = {
  key: 'editorial', name: 'Editorial', description: 'Oversized serif title and magazine-style rhythm.',
  accent: '#b45309', font: 'editorial', palette: { ink: '#1f1d1a', muted: '#7d766b', rule: '#e7e2d9' },
  render: (m, t) => {
    if (m.type === 'label') return <Doc m={m}><LabelPage m={m} t={t} header={<Text style={{ fontFamily: t.head, fontWeight: 900, fontSize: 18 }}>{m.seller.name}</Text>} /></Doc>
    const col = (label: string, value?: string) => value ? (
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 7, letterSpacing: 1.5, color: t.muted, textTransform: 'uppercase' }}>{label}</Text>
        <Text style={{ fontSize: 10, fontWeight: 600, marginTop: 3 }}>{value}</Text>
      </View>
    ) : null
    return (
      <Doc m={m}>
        <Page size={A4} style={pageStyle(t, { paddingHorizontal: 48 })}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Logo m={m} height={24} fallback={<Text style={{ fontFamily: t.head, fontWeight: 700, fontSize: 12 }}>{m.seller.name}</Text>} />
            <Text style={{ fontSize: 7.5, color: t.muted, letterSpacing: 1.5, textTransform: 'uppercase' }}>{m.seller.name}</Text>
          </View>
          <Text style={{ fontFamily: t.head, fontWeight: 900, fontSize: 48, marginTop: 26, lineHeight: 1, letterSpacing: -1 }}>{m.title}</Text>
          <View style={{ width: 64, borderBottomWidth: 3, borderBottomColor: t.accent, marginTop: 12 }} />
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 18 }}>
            {col('Number', m.number)}{col('Date', m.date)}{m.due && col(m.due.label, m.due.date)}{col('Reference', m.reference)}
          </View>
          <Body m={m} t={t} table="plain" totals="lined" />
          <Stamp m={m} t={t} />
          <Footer m={m} t={t} />
        </Page>
      </Doc>
    )
  },
}
