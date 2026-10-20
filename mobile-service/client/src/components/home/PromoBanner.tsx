import { Pressable, Text, View, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg'
import { absUrl, openHref } from '../../lib/links'
import { primary, status } from '../../theme'
import type { SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/PromoBanner.tsx at the mobile breakpoint.

const str = (v: unknown) => (typeof v === 'string' ? v : null)
const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const

export default function PromoBanner({ section }: SectionProps) {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const cfg = section.config ?? {}
  const { title, subtitle, eyebrow, cta_label: ctaLabel, cta_url: ctaUrl } = section
  const imageUrl = str(cfg.imageUrl)
  const imageUrlMobile = str(cfg.imageUrlMobile)
  const blurhash = str(cfg.blurhash)
  const mobileImg = imageUrlMobile ?? imageUrl ?? null
  const showCta = !!(ctaUrl && ctaLabel)

  if (!title && !subtitle && !eyebrow && !mobileImg && !showCta) return null
  const src = absUrl(mobileImg)
  const titleSize = Math.min(48, Math.max(24, width * 0.04)) // text-[clamp(1.5rem,4vw,3rem)]

  return (
    <View className="bg-surface px-4 py-8">
      <View className="rounded-2xl shadow-xl">
        <View className="min-h-[14rem] overflow-hidden rounded-2xl bg-black">
          {mobileImg ? (
            <>
              <Image
                source={src ? { uri: src } : undefined}
                placeholder={blurhash ? { blurhash } : undefined}
                style={FILL}
                contentFit="cover"
                transition={200}
              />
              {/* bg-gradient-to-r from-10% via-70% at 55% to-transparent */}
              <Svg style={FILL} width="100%" height="100%">
                <Defs>
                  <LinearGradient id="promo" x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0.1" stopColor={status.black} />
                    <Stop offset="0.55" stopColor={status.black} stopOpacity={0.7} />
                    <Stop offset="1" stopColor={status.black} stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                <Rect width="100%" height="100%" fill="url(#promo)" />
              </Svg>
            </>
          ) : (
            <Svg style={FILL} width="100%" height="100%">
              <Defs>
                <LinearGradient id="promoFallback" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0" stopColor={primary[600]} />
                  <Stop offset="1" stopColor={primary[800]} />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#promoFallback)" />
            </Svg>
          )}

          <View className="gap-3 px-6 py-10" style={{ maxWidth: '90%' }}>
            {eyebrow ? (
              <Text className="text-[10px] font-black uppercase text-white/70" style={{ letterSpacing: 2 }}>
                {eyebrow}
              </Text>
            ) : null}
            {title ? (
              <Text className="font-black text-white" style={{ fontSize: titleSize, lineHeight: titleSize * 1.05, letterSpacing: -titleSize * 0.025 }}>
                {title}
              </Text>
            ) : null}
            {subtitle ? <Text className="text-sm leading-relaxed text-white/60">{subtitle}</Text> : null}
            {showCta ? (
              <Pressable
                onPress={() => openHref(router, ctaUrl)}
                className="mt-2 flex-row items-center gap-2 self-start rounded-xl bg-white px-6 py-3 shadow-lg active:bg-white/90"
              >
                <Text className="text-sm font-bold text-black">{ctaLabel}</Text>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path d="M9 5l7 7-7 7" stroke={status.black} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  )
}
