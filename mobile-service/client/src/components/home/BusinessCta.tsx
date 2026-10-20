import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg'
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

const BUILDING =
  'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4'
const CHEVRON = 'M9 5l7 7-7 7'

const FEATURES = [
  {
    icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
    label: 'Tiered bulk pricing',
  },
  {
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    label: 'GST-compliant invoices',
  },
  {
    icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    label: '24h RFQ turnaround',
  },
]

function Glyph({ d, size, color }: { d: string; size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </Svg>
  )
}

export default function BusinessCta({ section, data }: SectionProps) {
  const router = useRouter()
  const { copy } = section

  return (
    <View className="bg-surface px-3 py-3">
      <View className="rounded-2xl shadow-2xl" style={{ backgroundColor: INK }}>
        <View className="relative overflow-hidden rounded-2xl" style={{ minHeight: 340, backgroundColor: INK }}>
          {/* Background image on the right portion, faded into the ink from the left */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Image
              source={{ uri: absUrl('/images/business-hero.webp') ?? undefined }}
              style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: '70%' }}
              contentFit="cover"
              contentPosition="center"
            />
            <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
              <Defs>
                <LinearGradient id="biz-x" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor={INK} stopOpacity={1} />
                  <Stop offset="0.35" stopColor={INK} stopOpacity={1} />
                  <Stop offset="0.6" stopColor={INK} stopOpacity={0.8} />
                  <Stop offset="1" stopColor={INK} stopOpacity={0} />
                </LinearGradient>
                <LinearGradient id="biz-y" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={status.black} stopOpacity={0.2} />
                  <Stop offset="0.5" stopColor={status.black} stopOpacity={0} />
                  <Stop offset="1" stopColor={status.black} stopOpacity={0.3} />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#biz-x)" />
              <Rect width="100%" height="100%" fill="url(#biz-y)" />
            </Svg>
          </View>

          <View className="z-10 gap-4 px-6 pb-16 pt-10" style={{ maxWidth: '58%' }}>
            <View className="flex-row items-center gap-2 self-start rounded-full border border-accent-500/40 bg-accent-500/20 px-3 py-1.5">
              <Glyph d={BUILDING} size={12} color={accent[400]} />
              <Text className="text-[10px] font-black uppercase text-accent-400" style={{ letterSpacing: 1.8 }}>
                {COPY.eyebrow}
              </Text>
            </View>

            <Text className="text-2xl font-black leading-tight text-white">{copy.title || COPY.title}</Text>

            <Text className="text-xs leading-relaxed text-white/60">{copy.subtitle || COPY.subtitle}</Text>

            <View className="gap-2 pt-1">
              {FEATURES.map(item => (
                <View key={item.label} className="flex-row items-center gap-2.5">
                  <Glyph d={item.icon} size={14} color={accent[400]} />
                  <Text className="shrink text-xs font-semibold text-white/70">{item.label}</Text>
                </View>
              ))}
            </View>

            <View className="flex-row flex-wrap gap-3 pt-1">
              <Pressable
                onPress={() => openHref(router, copy.ctaUrl || data.businessSignupUrl)}
                className="flex-row items-center gap-2 rounded-xl bg-accent-500 px-5 py-2.5 shadow-lg shadow-accent-500/25 active:bg-accent-400"
              >
                <Text className="text-xs font-black text-white">{copy.ctaLabel || COPY.ctaLabel}</Text>
                <Glyph d={CHEVRON} size={14} color={status.white} />
              </Pressable>
              <Pressable
                onPress={() => openHref(router, data.businessLandingUrl)}
                className="flex-row items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-5 py-2.5 active:bg-white/20"
              >
                <Text className="text-xs font-bold text-white">Learn More</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}
