import { useState } from 'react'
import { Pressable, View, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { Button, Gradient, Text } from '../../ui'
import FeedMedia from './FeedMedia'
import { absUrl, openHref } from '../../lib/links'
import { status, useTokens } from '../../theme'
import type { SectionProps } from '../../types/home'

// Site Builder's content blocks on the app home (mirrors of storefront components/visitor/site/ContentBlocks.tsx at the
// phone breakpoint). Their settings arrive as the section's config.

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
const paras = (text: string) => text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const
const RATIO: Record<string, number> = { '1:1': 1, '4:5': 4 / 5, '4:3': 4 / 3, '16:9': 16 / 9 }

function Paragraphs({ text, center = false }: { text: string; center?: boolean }) {
  return (
    <View className="gap-3">
      {paras(text).map((p, i) => (
        <Text key={i} className={`text-base leading-relaxed text-foreground-secondary ${center ? 'text-center' : ''}`}>
          {p}
        </Text>
      ))}
    </View>
  )
}

export function RichText({ section }: SectionProps) {
  const c = section.config ?? {}
  const center = c.align === 'center'
  return (
    <View className="bg-surface px-4 py-8 gap-3">
      {str(c.heading) ? <Text className={`font-display text-2xl font-bold text-foreground ${center ? 'text-center' : ''}`}>{str(c.heading)}</Text> : null}
      <Paragraphs text={String(c.body ?? '')} center={center} />
    </View>
  )
}

export function ImageText({ section }: SectionProps) {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const c = section.config ?? {}
  const img = absUrl(str(c.image))
  const ratio = RATIO[String(c.aspect)] ?? RATIO['4:5']
  return (
    <View className="bg-surface px-4 py-8 gap-4">
      <View className="overflow-hidden rounded-panel bg-surface-secondary" style={{ width: width - 32, height: (width - 32) / ratio }}>
        {img ? <FeedMedia image={img} video={null} blurhash={null} style={FILL} /> : null}
      </View>
      {str(c.heading) ? <Text className="font-display text-2xl font-bold text-foreground">{str(c.heading)}</Text> : null}
      <Paragraphs text={String(c.body ?? '')} />
      {str(c.ctaLabel) && str(c.ctaUrl) ? <Button label={str(c.ctaLabel)!} size="md" block={false} onPress={() => openHref(router, str(c.ctaUrl)!)} /> : null}
    </View>
  )
}

const HEIGHT: Record<string, number> = { short: 220, medium: 340, tall: 480 }

export function ImageBanner({ section }: SectionProps) {
  const router = useRouter()
  const c = section.config ?? {}
  const img = absUrl(str(c.mobileImage) ?? str(c.image))
  const light = c.overlay !== 'light'
  const center = c.align !== 'left'
  return (
    <View className="bg-black overflow-hidden" style={{ minHeight: HEIGHT[String(c.height)] ?? HEIGHT.medium, justifyContent: 'center' }}>
      {img ? <FeedMedia image={img} video={null} blurhash={null} style={FILL} /> : null}
      {c.overlay !== 'none' ? <Gradient stops={light ? [[0, status.black, 0.15], [1, status.black, 0.65]] : [[0, status.white, 0.2], [1, status.white, 0.6]]} /> : null}
      <View className={`px-6 py-10 gap-3 ${center ? 'items-center' : ''}`}>
        {str(c.heading) ? (
          <Text className={`font-display text-4xl font-extrabold ${light ? 'text-white' : 'text-black'} ${center ? 'text-center' : ''}`}>{str(c.heading)}</Text>
        ) : null}
        {str(c.subheading) ? <Text className={`text-base ${light ? 'text-white/85' : 'text-black/80'} ${center ? 'text-center' : ''}`}>{str(c.subheading)}</Text> : null}
        {str(c.ctaLabel) && str(c.ctaUrl) ? (
          <Button
            label={str(c.ctaLabel)!}
            size="md"
            block={false}
            trailing={<ChevronRight size={16} color={status.white} strokeWidth={2.2} />}
            onPress={() => openHref(router, str(c.ctaUrl)!)}
          />
        ) : null}
      </View>
    </View>
  )
}

export function Faq({ section }: SectionProps) {
  const c = section.config ?? {}
  const t = useTokens()
  const items = Array.isArray(c.items) ? (c.items as { q: string; a: string }[]) : []
  const [open, setOpen] = useState<number | null>(null)
  return (
    <View className="bg-surface px-4 py-8 gap-4">
      {str(c.heading) ? <Text className="font-display text-2xl font-bold text-foreground text-center">{str(c.heading)}</Text> : null}
      <View className="rounded-panel border border-border-default bg-surface-elevated">
        {items.map((it, i) => (
          <View key={i} className={i ? 'border-t border-border-default' : ''}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === i }} onPress={() => setOpen(o => (o === i ? null : i))} className="min-h-[52px] flex-row items-center justify-between gap-3 px-4 py-3">
              <Text className="flex-1 font-medium text-foreground">{it.q}</Text>
              <ChevronDown size={18} color={t.foregroundMuted} style={{ transform: [{ rotate: open === i ? '180deg' : '0deg' }] }} />
            </Pressable>
            {open === i ? (
              <View className="px-4 pb-4">
                <Paragraphs text={it.a} />
              </View>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  )
}
