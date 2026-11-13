import type { ReactNode } from 'react'
import { View } from 'react-native'
import { Card, Overline, Text } from '../../ui'

// What's in the box, usage & care and the Legal Metrology declarations, as on the web PDP
// (packages/store-core/src/components/visitor/pdp/ProductInfoSections.tsx). FAQs render separately.

const lines = (v?: string | null) =>
  (v ?? '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View>
      <Overline className="mb-2">{title}</Overline>
      {children}
    </View>
  )
}

const Body = ({ v }: { v: string }) => <Text className="text-sm leading-5 text-foreground-secondary">{v}</Text>

export default function ProductInfoSections({ product }: { product: Record<string, any> }) {
  const p = product
  const box = lines(p.in_the_box)
  const legal: [string, string | null][] = [
    ['Manufacturer', [p.manufacturer_name, p.manufacturer_address].filter(Boolean).join(', ') || null],
    ['Packer', [p.packer_name, p.packer_address].filter(Boolean).join(', ') || null],
    ['Importer', [p.importer_name, p.importer_address].filter(Boolean).join(', ') || null],
    ['Net quantity', p.net_quantity != null ? `${Number(p.net_quantity)} ${p.net_quantity_unit ?? ''}`.trim() : null],
    ['Month & year of manufacture', p.mfg_month_year ?? null],
    ['Best before', p.best_before ?? null],
    ['Country of origin', p.country_of_origin ?? null],
    ['Consumer care', p.consumer_care ?? null],
  ]
  const legalShown = legal.filter(([, v]) => v) as [string, string][]
  const usage: [string, string][] = (
    [
      ['How to use', p.usage_instructions],
      ['Care', p.care_instructions],
      ['Safety warnings', p.safety_warnings],
    ] as [string, string | null][]
  ).filter(([, v]) => v) as [string, string][]
  if (!box.length && !usage.length && !legalShown.length) return null

  return (
    <Card className="mb-6 p-5" padded={false}>
      <View className="gap-6">
        {box.length > 0 ? (
          <Block title="What's in the box">
            <View className="gap-1.5">
              {box.map((b, i) => (
                <View key={i} className="flex-row items-start gap-2">
                  <View className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
                  <Text className="flex-1 text-sm text-foreground">{b}</Text>
                </View>
              ))}
            </View>
          </Block>
        ) : null}
        {usage.map(([title, v]) => (
          <Block key={title} title={title}>
            <Body v={v} />
          </Block>
        ))}
        {legalShown.length > 0 ? (
          <>
            {box.length || usage.length ? <View className="border-t border-border-default" /> : null}
            <Block title="Legal disclosures">
              <View className="gap-3">
                {legalShown.map(([k, v]) => (
                  <View key={k}>
                    <Text className="mb-0.5 text-xs text-foreground-muted">{k}</Text>
                    <Body v={v} />
                  </View>
                ))}
              </View>
            </Block>
          </>
        ) : null}
      </View>
    </Card>
  )
}
