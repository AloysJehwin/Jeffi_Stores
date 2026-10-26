import { StyleSheet, View } from 'react-native'
import { Button, Gradient, Text, elevationClass, useElevation } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { Building2, ChevronRight, FileText, MessageCircleMore, Tag } from 'lucide-react-native'
import { absUrl, openHref } from '../../lib/links'
import { accent, secondary, status } from '../../theme'
import type { SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/BusinessCta.tsx at the mobile breakpoint.

const COPY = {
  eyebrow: 'For Business',
  title: 'Buying for a business?',
  subtitle: 'Bulk discounts, GSTIN invoicing, and a dedicated account manager. Trusted by 500+ businesses across India.',
  ctaLabel: 'Register Now',
}

// The web's near-black card colour; secondary-900 is the closest palette token.
const INK = secondary[900]

const FEATURES = [
  { icon: Tag, label: 'Tiered bulk pricing' },
  { icon: FileText, label: 'GST-compliant invoices' },
  { icon: MessageCircleMore, label: '24h RFQ turnaround' },
]

export default function BusinessCta({ section, data }: SectionProps) {
  const router = useRouter()
  const { copy } = section
  const shadow = useElevation('floating')

  return (
    <View className="bg-surface px-3 py-3">
      <View className={`rounded-panel ${elevationClass('floating')}`} style={[shadow, { backgroundColor: INK }]}>
        <View className="relative overflow-hidden rounded-panel" style={{ minHeight: 340, backgroundColor: INK }}>
          {/* Background image on the right portion, faded into the ink from the left */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Image
              source={{ uri: absUrl('/images/business-hero.webp') ?? undefined }}
              style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: '70%' }}
              contentFit="cover"
              contentPosition="center"
            />
            <Gradient dir="r" stops={[[0, INK], [0.35, INK], [0.6, INK, 0.8], [1, INK, 0]]} />
            <Gradient dir="b" stops={[[0, status.black, 0.2], [0.5, status.black, 0], [1, status.black, 0.3]]} />
          </View>

          <View className="z-10 gap-4 px-6 pb-16 pt-10" style={{ maxWidth: '58%' }}>
            <View className="flex-row items-center gap-2 self-start rounded-full border border-accent-500/40 bg-accent-500/20 px-3 py-1.5">
              <Building2 size={12} color={accent[400]} strokeWidth={2} />
              <Text className="text-[11px] font-extrabold uppercase text-accent-400" style={{ letterSpacing: 1.8 }}>
                {COPY.eyebrow}
              </Text>
            </View>

            <Text accessibilityRole="header" className="font-display text-2xl font-extrabold leading-tight text-white">
              {copy.title || COPY.title}
            </Text>

            <Text className="text-xs leading-relaxed text-white/60">{copy.subtitle || COPY.subtitle}</Text>

            <View className="gap-2 pt-1">
              {FEATURES.map(item => (
                <View key={item.label} className="flex-row items-center gap-2.5">
                  <item.icon size={14} color={accent[400]} strokeWidth={2} />
                  <Text className="shrink text-xs font-semibold text-white/70">{item.label}</Text>
                </View>
              ))}
            </View>

            <View className="flex-row flex-wrap gap-3 pt-1">
              <Button
                label={copy.ctaLabel || COPY.ctaLabel}
                size="sm"
                block={false}
                trailing={<ChevronRight size={14} color={status.white} strokeWidth={2.2} />}
                onPress={() => openHref(router, copy.ctaUrl || data.businessSignupUrl)}
              />
              <Button label="Learn More" variant="outline" size="sm" block={false} onPress={() => openHref(router, data.businessLandingUrl)} />
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}
