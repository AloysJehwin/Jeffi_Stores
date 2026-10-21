import { Pressable, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg'
import { absUrl, openHref } from '../../lib/links'
import { secondary, status } from '../../theme'
import type { SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/AboutSection.tsx at the mobile breakpoint.

const COPY = {
  eyebrow: 'About Us',
  title: 'Your Trusted Hardware Partner',
  body: 'We combine product breadth with expert service so your operations stay seamless and efficient.',
  imageUrl: '/images/Working.png',
  ctaLabel: 'Learn More',
  ctaUrl: '/about',
}

export default function AboutSection({ section, data }: SectionProps) {
  const router = useRouter()
  const { copy } = section
  const aboutCopy = copy.subtitle || data.aboutCopy
  const stats = (section.items as { value: string; label: string }[] | null) ?? data.stats

  return (
    <View className="bg-surface px-4 py-12">
      <View className="rounded-2xl bg-surface shadow-2xl">
        <View className="relative overflow-hidden rounded-2xl">
          <Image
            source={{ uri: absUrl(copy.imageUrl || COPY.imageUrl) ?? undefined }}
            accessibilityLabel={`${data.storeName} team`}
            style={{ width: '100%', height: 224 }}
            contentFit="cover"
          />
          {/* bg-gradient-to-t from-secondary-900/60 via-transparent to-transparent */}
          <Svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }} pointerEvents="none">
            <Defs>
              <LinearGradient id="about-fade" x1="0" y1="1" x2="0" y2="0">
                <Stop offset="0" stopColor={secondary[900]} stopOpacity={0.6} />
                <Stop offset="0.5" stopColor={secondary[900]} stopOpacity={0} />
                <Stop offset="1" stopColor={secondary[900]} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#about-fade)" />
          </Svg>
          <View className="absolute bottom-4 left-4 right-4 flex-row gap-3">
            {stats.map((s, i) => (
              <View key={i} className="flex-1 rounded-xl border border-white/15 bg-white/10 px-4 py-3">
                <Text className="text-2xl font-black text-white">{s.value}</Text>
                <Text className="mt-0.5 text-xs font-semibold text-white/60">{s.label}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View className="mt-8 gap-5">
        <View>
          <Text className="mb-2 text-[10px] font-black uppercase text-primary-500" style={{ letterSpacing: 2 }}>
            {copy.eyebrow || COPY.eyebrow}
          </Text>
          <Text className="text-2xl font-black leading-tight text-foreground">{copy.title || COPY.title}</Text>
        </View>
        <Text className="text-sm leading-relaxed text-foreground-secondary">{aboutCopy}</Text>
        <Text className="text-sm leading-relaxed text-foreground-secondary">{copy.body || COPY.body}</Text>

        <View className="flex-row flex-wrap gap-3 pt-2">
          <Pressable
            onPress={() => openHref(router, copy.ctaUrl || COPY.ctaUrl)}
            className="flex-row items-center gap-2 rounded-xl bg-primary-500 px-6 py-3 shadow-lg shadow-primary-500/20 active:bg-primary-600"
          >
            <Text className="text-sm font-bold text-white">{copy.ctaLabel || COPY.ctaLabel}</Text>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={status.white} strokeWidth={2}>
              <Path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </Svg>
          </Pressable>
          <Pressable
            onPress={() => openHref(router, '/products')}
            className="flex-row items-center gap-2 rounded-xl border border-border-default px-6 py-3 active:border-primary-400"
          >
            <Text className="text-sm font-bold text-foreground">Browse Products</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}
