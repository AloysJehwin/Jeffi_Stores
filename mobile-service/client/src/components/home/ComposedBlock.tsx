import { useEffect, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import { Award, Check, Clock, Gift, Heart, Leaf, MapPin, Package, Percent, Phone, RefreshCw, Shield, Sparkles, Star, Tag, Truck } from 'lucide-react-native'
import { Button, Rail, Text } from '../../ui'
import ProductCard from '../product/ProductCard'
import FeedMedia from './FeedMedia'
import { Grid } from './layout'
import { absUrl, openHref } from '../../lib/links'
import { useTokens } from '../../theme'
import type { CardProduct, SectionProps } from '../../types/home'

// Site Builder's composed block on the app home: the same primitive tree as the web (storefront
// components/visitor/site/ComposedBlock.tsx) at the phone breakpoint. Data nodes come in extras by node path,
// products already as card props. Unknown kinds render nothing, so newer trees stay safe on older builds.

type Node = { kind: string; children?: Node[]; [k: string]: any }
type Data = Record<string, unknown>

const ICON = { truck: Truck, shield: Shield, star: Star, heart: Heart, gift: Gift, tag: Tag, sparkles: Sparkles, leaf: Leaf, award: Award, clock: Clock, phone: Phone, 'map-pin': MapPin, check: Check, percent: Percent, package: Package, refresh: RefreshCw } as const
const BG: Record<string, string> = { default: 'bg-surface', muted: 'bg-surface-secondary', brand: 'bg-primary-600', accent: 'bg-accent-500', dark: 'bg-gray-900' }
const ON_DARK = new Set(['brand', 'accent', 'dark'])
const PAD: Record<string, number> = { none: 0, xs: 8, sm: 16, md: 32, lg: 48, xl: 64 }
const GAP: Record<string, number> = { none: 0, xs: 4, sm: 8, md: 16, lg: 24, xl: 32 }
const TEXT_ALIGN: Record<string, string> = { left: 'text-left', center: 'text-center', right: 'text-right' }
const ITEMS: Record<string, string> = { left: 'items-start', center: 'items-center', right: 'items-end' }
const H: Record<number, string> = { 1: 'font-display text-3xl font-extrabold', 2: 'font-display text-2xl font-bold', 3: 'text-lg font-semibold' }
const ratio = (a?: string) => {
  const m = a?.match(/^(\d+):(\d+)$/)
  return m ? Number(m[1]) / Number(m[2]) : null
}

function Countdown({ endsAt, label, dark }: { endsAt: string; label: string; dark: boolean }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const left = Math.max(0, Date.parse(endsAt) - now)
  if (!left) return null
  const s = Math.floor(left / 1000)
  const parts: [string, number][] = [['Days', Math.floor(s / 86400)], ['Hours', Math.floor((s % 86400) / 3600)], ['Mins', Math.floor((s % 3600) / 60)], ['Secs', s % 60]]
  const fg = dark ? 'text-white' : 'text-foreground'
  return (
    <View className="items-center gap-2">
      {label ? <Text className={`text-xs font-semibold uppercase ${fg}`}>{label}</Text> : null}
      <View className="flex-row gap-2">
        {parts.map(([k, v]) => (
          <View key={k} className="min-w-14 items-center rounded-lg bg-black/10 px-2 py-1.5">
            <Text className={`font-display text-2xl ${fg}`}>{String(v).padStart(2, '0')}</Text>
            <Text className={`text-[10px] uppercase ${fg}`}>{k}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function Tiles({ layout, cols, children }: { layout?: string; cols?: number; children: ReactNode[] }) {
  return layout === 'carousel' ? <Rail>{children}</Rail> : <Grid cols={cols ?? 2} gap={12} inset={0}>{children}</Grid>
}

function render(n: Node, path: string, data: Data, dark: boolean, width: number, router: ReturnType<typeof useRouter>, tokens: ReturnType<typeof useTokens>): ReactNode {
  const kids = (onDark = dark) => n.children?.map((c, i) => <View key={i}>{render(c, `${path}.${i}`, data, onDark, width, router, tokens)}</View>)
  const fg = dark ? 'text-white' : 'text-foreground'
  const sub = dark ? 'text-white/80' : 'text-foreground-secondary'
  switch (n.kind) {
    case 'section': {
      const onDark = ON_DARK.has(n.tone)
      return (
        <View className={BG[n.tone] ?? 'bg-surface'} style={{ paddingVertical: PAD[n.padding] ?? 32, paddingHorizontal: 16, gap: 20 }}>
          {kids(onDark)}
        </View>
      )
    }
    case 'stack':
      return <View className={ITEMS[n.align] ?? ''} style={{ gap: GAP[n.gap] ?? 8 }}>{kids()}</View>
    case 'grid':
      return (
        <Grid cols={n.cols?.web_mobile ?? 1} gap={GAP[n.gap] ?? 16} inset={0}>
          {kids() ?? []}
        </Grid>
      )
    case 'columns':
      return <View style={{ gap: GAP[n.gap] ?? 24 }}>{kids()}</View>
    case 'carousel':
      return <Rail>{kids() ?? []}</Rail>
    case 'heading':
      return <Text className={`${H[n.level] ?? H[2]} ${fg} ${TEXT_ALIGN[n.align] ?? ''}`}>{n.text}</Text>
    case 'text':
      return (
        <View className="gap-3">
          {String(n.text)
            .split(/\n{2,}/)
            .map((p, i) => (
              <Text key={i} className={`${n.size === 'lg' ? 'text-lg' : n.size === 'sm' ? 'text-sm' : 'text-base'} leading-relaxed ${sub} ${TEXT_ALIGN[n.align] ?? ''}`}>
                {p}
              </Text>
            ))}
        </View>
      )
    case 'image': {
      const src = absUrl(n.src)
      const r = ratio(n.aspect?.web_mobile ?? n.aspect?.web) ?? 4 / 3
      const img = (
        <View className="overflow-hidden rounded-lg bg-surface-secondary" style={{ width: width - 32, height: (width - 32) / r }}>
          {src ? <FeedMedia image={src} video={null} blurhash={null} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
        </View>
      )
      return n.href ? <Pressable onPress={() => openHref(router, n.href)}>{img}</Pressable> : img
    }
    case 'button':
      return <Button label={n.label} size="md" block={false} variant={n.variant === 'solid' ? 'primary' : 'outline'} onPress={() => openHref(router, n.href)} />
    case 'badge':
      return (
        <View className={`self-start rounded-full px-3 py-1 ${BG[n.tone] ?? 'bg-accent-500'}`}>
          <Text className={`text-xs font-semibold ${ON_DARK.has(n.tone) ? 'text-white' : 'text-foreground'}`}>{n.text}</Text>
        </View>
      )
    case 'icon': {
      const Icon = ICON[n.name as keyof typeof ICON] ?? Sparkles
      return <Icon size={n.size === 'sm' ? 20 : n.size === 'lg' ? 40 : 28} color={dark ? '#fff' : tokens.accent600} />
    }
    case 'spacer':
      return <View style={{ height: PAD[n.size] ?? 32 }} />
    case 'divider':
      return <View className="h-px bg-border-default" />
    case 'products': {
      const rows = (data[path] as CardProduct[] | undefined) ?? []
      if (!rows.length) return null
      return <Tiles layout={n.layout} cols={n.cols?.web_mobile}>{rows.map(p => <ProductCard key={p.id} product={p} imageAspect={ratio(n.aspect?.web_mobile ?? n.aspect?.web)} />)}</Tiles>
    }
    case 'categories': {
      const rows = (data[path] as { id: string; name: string; slug: string; image_url: string | null }[] | undefined) ?? []
      if (!rows.length) return null
      return (
        <Tiles layout={n.layout} cols={n.cols?.web_mobile}>
          {rows.map(c => (
            <Pressable key={c.id} onPress={() => openHref(router, `/categories/${c.slug}`)} className="gap-2">
              <View className="aspect-square overflow-hidden rounded-lg bg-surface-secondary">
                {absUrl(c.image_url) ? <FeedMedia image={absUrl(c.image_url)!} video={null} blurhash={null} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
              </View>
              <Text className={`text-sm font-semibold ${fg}`}>{c.name}</Text>
            </Pressable>
          ))}
        </Tiles>
      )
    }
    case 'brands': {
      const rows = (data[path] as { id: string; name: string; slug: string }[] | undefined) ?? []
      if (!rows.length) return null
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {rows.map(b => (
            <Pressable key={b.id} onPress={() => openHref(router, `/brands/${b.slug}`)} className="rounded-lg border border-border-default bg-surface px-4 py-3">
              <Text className="text-sm font-semibold text-foreground">{b.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )
    }
    case 'review': {
      const rows = (data[path] as { id: string; rating: number; comment: string; author: string; productName: string }[] | undefined) ?? []
      if (!rows.length) return null
      return (
        <View className="gap-3">
          {rows.map(r => (
            <View key={r.id} className="rounded-2xl border border-border-default bg-surface p-4 gap-2">
              <Text className="text-accent-500">{'★'.repeat(r.rating)}</Text>
              <Text className="text-sm text-foreground-secondary">“{r.comment.length > 220 ? `${r.comment.slice(0, 217)}…` : r.comment}”</Text>
              <Text className="text-xs text-foreground-muted">{r.author} on {r.productName}</Text>
            </View>
          ))}
        </View>
      )
    }
    case 'offers': {
      const rows = (data[path] as { id: string; slug: string; title: string; subtitle: string | null; image_url: string | null; image_url_card: string | null }[] | undefined) ?? []
      if (!rows.length) return null
      return (
        <Rail>
          {rows.map(o => (
            <Pressable key={o.id} onPress={() => openHref(router, `/products?offer=${encodeURIComponent(o.slug)}`)} className="overflow-hidden rounded-2xl bg-gray-900" style={{ width: width * 0.7, aspectRatio: 4 / 5 }}>
              {absUrl(o.image_url_card ?? o.image_url) ? <FeedMedia image={absUrl(o.image_url_card ?? o.image_url)!} video={null} blurhash={null} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
              <View className="absolute bottom-0 left-0 right-0 bg-black/50 p-4">
                <Text className="font-display text-xl text-white">{o.title}</Text>
                {o.subtitle ? <Text className="text-sm text-white/90">{o.subtitle}</Text> : null}
              </View>
            </Pressable>
          ))}
        </Rail>
      )
    }
    case 'countdown':
      return Date.parse(n.endsAt) > Date.now() ? <Countdown endsAt={n.endsAt} label={n.label ?? ''} dark={dark} /> : null
    case 'marquee':
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className={`rounded-lg ${BG[n.tone] ?? 'bg-primary-600'}`} contentContainerStyle={{ gap: 32, paddingHorizontal: 16, paddingVertical: 12 }}>
          {(n.items as string[]).map((t, i) => (
            <Text key={i} className={`text-sm font-semibold ${ON_DARK.has(n.tone) ? 'text-white' : 'text-foreground'}`}>
              {t}
            </Text>
          ))}
        </ScrollView>
      )
    default:
      return null
  }
}

export function Composed({ section, data }: SectionProps) {
  const router = useRouter()
  const tokens = useTokens()
  const { width } = useWindowDimensions()
  const tree = (section.config as { tree?: Node } | null)?.tree
  if (!tree || typeof tree !== 'object' || !tree.kind) return null
  return <>{render(tree, '0', (data.extras[section.id] as Data | undefined) ?? {}, false, width, router, tokens)}</>
}
