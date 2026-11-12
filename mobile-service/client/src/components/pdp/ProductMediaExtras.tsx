import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { requireOptionalNativeModule } from 'expo'
import * as WebBrowser from 'expo-web-browser'
import { Box, FileText, Music, Play, RotateCw } from 'lucide-react-native'
import { Card, Caption, Overline, Text } from '../../ui'
import { absUrl } from '../../lib/links'
import { useTokens } from '../../theme'
import type { PdpMedia } from '../../api/pdp'

// Product media beyond photos: videos play in place (expo-video when the binary has it), video links,
// audio and documents open in the in-app browser, and 3D / 360° show their poster (or first frame).

type ExpoVideo = typeof import('expo-video')
let mod: ExpoVideo | null | undefined
function expoVideo(): ExpoVideo | null {
  if (mod === undefined) {
    try {
      mod = requireOptionalNativeModule('ExpoVideo') ? (require('expo-video') as ExpoVideo) : null
    } catch {
      mod = null
    }
  }
  return mod
}

const GROUPS = ['image', 'video', 'model_3d', 'spin_360', 'audio', 'document'] as const
const groupOf = (k: string) => (k === 'external_video' ? 'video' : k)

/** The web's resolveMedia: per kind, the sub-variant's own items, else the variant's, else the product's. */
export function resolvePdpMedia(items: PdpMedia[], variantId?: string | null, subVariantId?: string | null): PdpMedia[] {
  const out: PdpMedia[] = []
  for (const g of GROUPS) {
    const of = items.filter(m => groupOf(m.kind) === g)
    const sub = subVariantId ? of.filter(m => m.sub_variant_id === subVariantId) : []
    const variant = variantId ? of.filter(m => m.variant_id === variantId) : []
    const own = sub.length ? sub : variant.length ? variant : of.filter(m => m.product_id)
    out.push(...[...own].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order))
  }
  return out
}

function poster(m: PdpMedia): string | null {
  if (m.thumbnail_url) return m.thumbnail_url
  if (m.kind === 'spin_360') return m.metadata?.frames?.[0] ?? null
  if (m.kind === 'external_video') {
    const id = /(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{6,20})/.exec(m.url)?.[1]
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null
  }
  return null
}

// Rendered only when the binary has expo-video (see the caller).
function InlineVideo({ m }: { m: PdpMedia }) {
  const ev = expoVideo()!
  const player = ev.useVideoPlayer(absUrl(m.url) || m.url)
  const { VideoView } = ev
  return (
    <View className="aspect-video w-full overflow-hidden rounded-xl bg-black">
      <VideoView player={player} style={{ width: '100%', height: '100%' }} nativeControls contentFit="contain" />
    </View>
  )
}

function Tile({ m }: { m: PdpMedia }) {
  const t = useTokens()
  const still = absUrl(poster(m))
  const label =
    m.kind === 'model_3d' ? '3D model' : m.kind === 'spin_360' ? '360° view' : m.kind === 'audio' ? 'Audio' : 'Video'
  const Icon = m.kind === 'model_3d' ? Box : m.kind === 'spin_360' ? RotateCw : m.kind === 'audio' ? Music : Play
  const opens = m.kind === 'external_video' || m.kind === 'video' || m.kind === 'audio'
  return (
    <Pressable
      accessibilityRole={opens ? 'button' : 'image'}
      accessibilityLabel={m.caption || m.alt || label}
      disabled={!opens}
      onPress={() => void WebBrowser.openBrowserAsync(absUrl(m.url) || m.url)}
      className="aspect-video w-full overflow-hidden rounded-xl bg-surface-secondary"
    >
      {still ? <Image source={{ uri: still }} style={{ width: '100%', height: '100%' }} contentFit="contain" /> : null}
      <View className="absolute bottom-2 left-2 flex-row items-center gap-1 rounded-full bg-black/60 px-2.5 py-1">
        <Icon size={14} color="#fff" />
        <Text className="text-xs text-white">{m.caption || label}</Text>
      </View>
      {!still ? (
        <View className="absolute inset-0 items-center justify-center">
          <Icon size={28} color={t.foregroundMuted} />
        </View>
      ) : null}
    </Pressable>
  )
}

export default function ProductMediaExtras({ items }: { items: PdpMedia[] }) {
  const extras = items.filter(m => m.kind !== 'image' && m.kind !== 'document')
  const docs = items.filter(m => m.kind === 'document')
  const [shown, setShown] = useState(3)
  if (extras.length === 0 && docs.length === 0) return null
  return (
    <Card className="mb-6 p-5" padded={false}>
      {extras.length > 0 ? (
        <View className="gap-3">
          <Overline>{'Videos, 3D & more'}</Overline>
          {extras.slice(0, shown).map(m => (m.kind === 'video' && expoVideo() ? <InlineVideo key={m.id} m={m} /> : <Tile key={m.id} m={m} />))}
          {extras.length > shown ? (
            <Pressable onPress={() => setShown(n => n + 3)} accessibilityRole="button">
              <Caption className="text-accent-600">Show more</Caption>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {docs.length > 0 ? (
        <View className={extras.length ? 'mt-5 gap-2' : 'gap-2'}>
          <Overline>{'Documents & downloads'}</Overline>
          {docs.map(d => (
            <Pressable
              key={d.id}
              accessibilityRole="link"
              onPress={() => void WebBrowser.openBrowserAsync(absUrl(d.url) || d.url)}
              className="flex-row items-center gap-3 rounded-lg border border-border-default px-3 py-2.5"
            >
              <FileText size={18} color="#ef4444" />
              <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
                {d.caption || d.file_name || 'Document'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Card>
  )
}

/** Published product FAQs, collapsed to the question until tapped. */
export function ProductFaqs({ faqs }: { faqs: { id?: string; question: string; answer: string }[] }) {
  const [open, setOpen] = useState<number | null>(null)
  if (!faqs?.length) return null
  return (
    <Card className="mb-6 p-5" padded={false}>
      <Text accessibilityRole="header" className="mb-3 font-display text-xl font-extrabold text-foreground">
        Frequently asked questions
      </Text>
      {faqs.map((f, i) => (
        <Pressable
          key={f.id ?? i}
          accessibilityRole="button"
          accessibilityState={{ expanded: open === i }}
          onPress={() => setOpen(o => (o === i ? null : i))}
          className="border-t border-border-default py-3"
        >
          <Text className="text-sm font-semibold text-foreground">{f.question}</Text>
          {open === i ? <Text className="mt-1.5 text-sm text-foreground-secondary">{f.answer}</Text> : null}
        </Pressable>
      ))}
    </Card>
  )
}
