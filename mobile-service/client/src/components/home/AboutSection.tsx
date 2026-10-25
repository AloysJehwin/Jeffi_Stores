import { View } from 'react-native'
import { Button, Overline, Text, elevationClass, useElevation } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { ChevronRight } from 'lucide-react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
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
  const shadow = useElevation('overlay')

  return (
    <View className="bg-surface px-4 py-12">
      <View style={shadow} className={`rounded-panel bg-surface ${elevationClass('overlay')}`}>
        <View className="relative overflow-hidden rounded-panel">
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
                <Text className="font-display text-2xl font-extrabold text-white">{s.value}</Text>
                <Text className="mt-0.5 text-xs font-semibold text-white/60">{s.label}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View className="mt-8 gap-5">
        <View>
          <Overline className="mb-2 text-primary-500" style={{ letterSpacing: 2 }}>
            {copy.eyebrow || COPY.eyebrow}
          </Overline>
          <Text accessibilityRole="header" className="font-display text-2xl font-extrabold leading-tight tracking-tight text-foreground">
            {copy.title || COPY.title}
          </Text>
        </View>
        <Text className="text-sm leading-relaxed text-foreground-secondary">{aboutCopy}</Text>
        <Text className="text-sm leading-relaxed text-foreground-secondary">{copy.body || COPY.body}</Text>

        <View className="flex-row flex-wrap gap-3 pt-2">
          <Button
            label={copy.ctaLabel || COPY.ctaLabel}
            size="md"
            block={false}
            trailing={<ChevronRight size={16} color={status.white} strokeWidth={2.2} />}
            onPress={() => openHref(router, copy.ctaUrl || COPY.ctaUrl)}
          />
          <Button label="Browse Products" variant="outline" size="md" block={false} onPress={() => openHref(router, '/products')} />
        </View>
      </View>
    </View>
  )
}
