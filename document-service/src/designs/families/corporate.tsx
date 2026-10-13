import { Page, View, Text } from '@react-pdf/renderer'
import { Doc, Body, Footer, Logo, Meta, Stamp, LabelPage, onColor, A4, pageStyle } from '../kit.js'
import type { Design } from '../types.js'

// Two-tone: dark band with logo and title, accent strip, meta card on the right.
export const corporate: Design = {
  key: 'corporate', name: 'Corporate', description: 'Two-tone dark band with logo, accent strip and a details card.',
  accent: '#0ea5e9', font: 'modern', palette: { ink: '#0f172a', muted: '#64748b', rule: '#e2e8f0' },
  render: (m, t) => {
    const dark = '#0f172a'
    if (m.type === 'label') return <Doc m={m}><LabelPage m={m} t={t} header={<View><View style={{ backgroundColor: dark, padding: 8 }}><Text style={{ color: '#ffffff', fontWeight: 700, fontSize: 11 }}>{m.seller.name}</Text></View><View style={{ height: 4, backgroundColor: t.accent }} /></View>} /></Doc>
    return (
      <Doc m={m}>
        <Page size={A4} style={pageStyle(t)}>
          <View style={{ marginHorizontal: -40, marginTop: -40 }}>
            <View style={{ backgroundColor: dark, paddingHorizontal: 40, paddingTop: 30, paddingBottom: 34, flexDirection: 'row', justifyContent: 'space-between' }}>
              <View>
                <Logo m={m} height={28} fallback={<Text style={{ color: '#ffffff', fontFamily: t.head, fontWeight: 700, fontSize: 14 }}>{m.seller.name}</Text>} />
                <Text style={{ color: '#ffffff', fontFamily: t.head, fontWeight: 700, fontSize: 24, marginTop: 14 }}>{m.title}</Text>
              </View>
            </View>
            <View style={{ height: 6, backgroundColor: t.accent }} />
          </View>
          <View style={{ position: 'absolute', top: 28, right: 40, width: 190, backgroundColor: '#ffffff', borderRadius: 6, padding: 12, borderWidth: 0.8, borderColor: t.rule }}>
            <Text style={{ fontSize: 7, letterSpacing: 1.2, color: t.muted, textTransform: 'uppercase', marginBottom: 6 }}>Details</Text>
            <Meta m={m} t={t} />
            <View style={{ marginTop: 6, backgroundColor: t.accent, borderRadius: 4, paddingVertical: 5, paddingHorizontal: 8 }}>
              <Text style={{ color: onColor(t.accent), fontSize: 8, fontWeight: 700 }}>{m.showPrices ? `Total  ₹${m.totals.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : `${m.lines.length} items`}</Text>
            </View>
          </View>
          <Body m={m} t={t} table="band" totals="band" />
          <Stamp m={m} t={t} />
          <Footer m={m} t={t} />
        </Page>
      </Doc>
    )
  },
}
