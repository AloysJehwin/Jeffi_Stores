import { View, useWindowDimensions } from 'react-native'
import { Button, Gradient, Overline, Text, elevationClass, useElevation } from '../../ui'
import { useRouter } from 'expo-router'
import { ChevronRight } from 'lucide-react-native'
import FeedMedia from './FeedMedia'
import { absUrl, openHref } from '../../lib/links'
import { SHAPE_COMPACT_H, shapeBox } from '../../lib/shape'
import { primary, status } from '../../theme'
import type { SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/PromoBanner.tsx at the mobile breakpoint.

const str = (v: unknown) => (typeof v === 'string' ? v : null)
const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const

export default function PromoBanner({ section }: SectionProps) {
  const router = useRouter()
  const { width, height } = useWindowDimensions()
  const cfg = section.config ?? {}
  const { title, subtitle, eyebrow, cta_label: ctaLabel, cta_url: ctaUrl } = section
  const imageUrl = str(cfg.imageUrl)
  const imageUrlMobile = str(cfg.imageUrlMobile)
  const blurhash = str(cfg.blurhash)
  const mobileImg = imageUrlMobile ?? imageUrl ?? null
  const video = section.copy.video ?? str(cfg.video)
  const showCta = !!(ctaUrl && ctaLabel)
  const shadow = useElevation('overlay')

  if (!title && !subtitle && !eyebrow && !mobileImg && !video && !showCta) return null
  const src = absUrl(mobileImg)
  // An admin-set shape inside px-4: exact, and narrowed rather than taller than 80% of the screen.
  const box = section.aspect ? shapeBox(width - 32, section.aspect, height * 0.8) : null
  const compact = !!box && box.height < SHAPE_COMPACT_H
  const titleSize = Math.min(48, Math.max(24, width * 0.04), box ? box.height * 0.16 : 48) // text-[clamp(1.5rem,4vw,3rem)]

  return (
    <View className="bg-surface px-4 py-8">
      <View style={[shadow, box && { width: box.width, alignSelf: 'center' }]} className={`rounded-panel ${elevationClass('overlay')}`}>
        <View
          className={`${box ? '' : 'min-h-[14rem] '}overflow-hidden rounded-panel bg-black`}
          style={box ? { height: box.height, justifyContent: 'center' } : undefined}
        >
          {mobileImg || video ? (
            <>
              <FeedMedia image={src} video={video} blurhash={blurhash} style={FILL} />
              {/* bg-gradient-to-r from-10% via-70% at 55% to-transparent */}
              <Gradient dir="r" stops={[[0.1, status.black], [0.55, status.black, 0.7], [1, status.black, 0]]} />
            </>
          ) : (
            <Gradient stops={[[0, primary[600]], [1, primary[800]]]} />
          )}

          <View className={compact ? 'gap-2 px-6 py-4' : 'gap-3 px-6 py-10'} style={{ maxWidth: '90%' }}>
            {eyebrow && !compact ? (
              <Overline className="text-white/70" style={{ letterSpacing: 2 }}>
                {eyebrow}
              </Overline>
            ) : null}
            {title ? (
              <Text className="font-display font-extrabold text-white" style={{ fontSize: titleSize, lineHeight: titleSize * 1.05, letterSpacing: -titleSize * 0.025 }}>
                {title}
              </Text>
            ) : null}
            {subtitle && !compact ? <Text className="text-sm leading-relaxed text-white/60">{subtitle}</Text> : null}
            {showCta ? (
              <Button
                label={ctaLabel}
                size="md"
                block={false}
                className="mt-2"
                trailing={<ChevronRight size={16} color={status.white} strokeWidth={2.2} />}
                onPress={() => openHref(router, ctaUrl)}
              />
            ) : null}
          </View>
        </View>
      </View>
    </View>
  )
}
