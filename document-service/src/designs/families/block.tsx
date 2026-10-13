import { Page, View, Text } from '@react-pdf/renderer'
import { Doc, ItemsTable, TotalsBlock, AmountWords, NotesTerms, PartyBlock, Logo, Meta, Stamp, LabelPage, onColor, tint, A4 } from '../kit.js'
import type { Theme } from '../kit.js'
import type { Design } from '../types.js'

// Bold accent sidebar carrying the logo, title, meta and parties; items on the right.
export const block: Design = {
  key: 'block', name: 'Block', description: 'Bold colour sidebar with your logo, details and parties; items alongside.',
  accent: '#0f766e', font: 'geometric',
  render: (m, t) => {
    const fg = onColor(t.accent)
    const side: Theme = { ...t, ink: fg, muted: tint(fg === '#ffffff' ? '#ffffff' : '#111111', fg === '#ffffff' ? 0.25 : 0.4), rule: tint(t.accent, 0.3) }
    if (m.type === 'label') return <Doc m={m}><LabelPage m={m} t={t} header={<View style={{ backgroundColor: t.accent, padding: 8, borderRadius: 2 }}><Text style={{ color: fg, fontWeight: 700, fontSize: 11 }}>{m.title.toUpperCase()}</Text></View>} /></Doc>
    return (
      <Doc m={m}>
        <Page size={A4} style={{ paddingTop: 40, paddingBottom: 60, paddingLeft: 214, paddingRight: 36, fontFamily: t.body, color: t.ink, fontSize: 9 }}>
          <View fixed style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 184, backgroundColor: t.accent, paddingHorizontal: 22, paddingTop: 40 }}>
            <Logo m={m} height={30} fallback={<Text style={{ color: fg, fontFamily: t.head, fontWeight: 700, fontSize: 13 }}>{m.seller.name}</Text>} />
            <Text style={{ color: fg, fontFamily: t.head, fontWeight: 700, fontSize: 22, marginTop: 22, lineHeight: 1.1 }}>{m.title}</Text>
            <View style={{ marginTop: 14 }}><Meta m={m} t={side} /></View>
            <View style={{ marginTop: 22 }}><PartyBlock label={m.labels.from} p={m.seller} t={side} size={8} /></View>
            <View style={{ marginTop: 16 }}><PartyBlock label={m.labels.to} p={m.buyer} t={side} size={8} /></View>
            {m.shipTo && <View style={{ marginTop: 16 }}><PartyBlock label={m.labels.ship} p={m.shipTo} t={side} size={8} /></View>}
            <Text style={{ position: 'absolute', bottom: 24, left: 22, color: fg, fontSize: 7, opacity: 0.8 }} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
          <ItemsTable m={m} t={t} variant="lined" size={8} />
          <TotalsBlock m={m} t={t} variant="band" width={210} />
          <AmountWords m={m} t={t} />
          <NotesTerms m={m} t={t} />
          <Stamp m={m} t={t} />
        </Page>
      </Doc>
    )
  },
}
