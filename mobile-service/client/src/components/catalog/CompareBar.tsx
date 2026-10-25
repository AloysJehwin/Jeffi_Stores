import { Pressable, ScrollView, View } from 'react-native'
import { Text } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CloseIcon, PhotoIcon, PlusIcon } from './icons'
import { absUrl } from '../../lib/links'
import { useCompareStore, type CompareProduct } from '../../stores/compareStore'
import { accent, status, useTokens } from '../../theme'

// Mirrors of controller-service components/visitor/CompareBar.tsx (fixed bottom bar, 2+ queued) and
// CompareStrip.tsx (inline strip on the product listing, 1+ queued).

function useOpenCompare() {
  const router = useRouter()
  return (list: CompareProduct[]) => router.push({ pathname: '/compare', params: { ids: list.map(p => p.id).join(',') } })
}

function Thumb({ p, size, onRemove, bordered }: { p: CompareProduct; size: number; onRemove: () => void; bordered: string }) {
  const t = useTokens()
  const src = absUrl(p.image)
  return (
    <View className="relative shrink-0">
      <View className={`overflow-hidden rounded-lg border ${bordered}`} style={{ width: size, height: size }}>
        {src ? (
          <Image source={{ uri: src }} contentFit="contain" style={{ flex: 1, margin: size > 40 ? 4 : 2 }} accessibilityLabel={p.name} />
        ) : (
          <View className="flex-1 items-center justify-center">
            <PhotoIcon size={size > 40 ? 20 : 16} strokeWidth={size > 40 ? 1 : 1.5} color={t.foregroundMuted} />
          </View>
        )}
      </View>
      {/* Hover-revealed on the web; always shown on touch. */}
      <Pressable
        onPress={onRemove}
        hitSlop={6}
        accessibilityLabel={`Remove ${p.name}`}
        className={`absolute items-center justify-center rounded-full bg-red-500 shadow ${size > 40 ? '-right-1.5 -top-1.5 h-5 w-5' : '-right-1 -top-1 h-4 w-4'}`}
      >
        <CloseIcon size={size > 40 ? 12 : 10} strokeWidth={size > 40 ? 2.5 : 3} color={status.white} />
      </Pressable>
    </View>
  )
}

export default function CompareBar() {
  const t = useTokens()
  const insets = useSafeAreaInsets()
  const { compareList, removeFromCompare, clearCompare } = useCompareStore()
  const open = useOpenCompare()
  if (compareList.length < 2) return null

  return (
    <View
      className="absolute bottom-0 left-0 right-0 z-30 border-t border-border-default bg-surface-elevated shadow-2xl"
      style={{ paddingBottom: insets.bottom }}
    >
      <View className="flex-row items-center gap-3 px-4 py-3">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="min-w-0 flex-1" contentContainerStyle={{ gap: 8, paddingTop: 6, paddingRight: 6 }}>
          {compareList.map(p => (
            <Thumb key={p.id} p={p} size={48} bordered="border-border-default bg-surface-secondary" onRemove={() => removeFromCompare(p.id)} />
          ))}
          {compareList.length < 4 ? (
            <View className="h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-border-default">
              <PlusIcon size={20} strokeWidth={1.5} color={t.foregroundMuted} />
            </View>
          ) : null}
        </ScrollView>

        <View className="shrink-0 flex-row items-center gap-2">
          <Pressable onPress={clearCompare} className="px-2 py-1.5">
            <Text className="text-xs text-foreground-muted">Clear</Text>
          </Pressable>
          <Pressable onPress={() => open(compareList)} className="rounded-lg bg-accent-500 px-4 py-2 active:bg-accent-600">
            <Text className="text-sm font-semibold text-white">Compare Now</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

export function CompareStrip() {
  const { compareList, removeFromCompare, clearCompare } = useCompareStore()
  const open = useOpenCompare()
  if (compareList.length === 0) return null
  const canCompare = compareList.length >= 2

  return (
    <View className="mb-6 flex-row items-center gap-3 rounded-xl border border-accent-200 bg-accent-50 p-3 dark:border-accent-800 dark:bg-accent-900/20">
      <View className="min-w-0 flex-1 flex-row items-center gap-2">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="shrink" contentContainerStyle={{ gap: 6, paddingTop: 4, paddingRight: 4 }}>
          {compareList.map(p => (
            <Thumb key={p.id} p={p} size={40} bordered="border-accent-200 bg-surface dark:border-accent-700" onRemove={() => removeFromCompare(p.id)} />
          ))}
          {Array.from({ length: Math.max(0, 2 - compareList.length) }).map((_, i) => (
            <View
              key={`empty-${i}`}
              className="h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-accent-300 dark:border-accent-700"
            >
              <PlusIcon size={14} color={accent[400]} />
            </View>
          ))}
        </ScrollView>
        <Text className="text-xs text-accent-600 dark:text-accent-400">{compareList.length} / 4</Text>
      </View>

      <View className="shrink-0 flex-row items-center gap-2">
        <Pressable onPress={clearCompare} className="px-2 py-1">
          <Text className="text-xs text-accent-600 dark:text-accent-400">Clear</Text>
        </Pressable>
        <Pressable
          onPress={() => canCompare && open(compareList)}
          disabled={!canCompare}
          className={`rounded-lg bg-accent-500 px-3 py-2 ${canCompare ? 'active:bg-accent-600' : 'opacity-50'}`}
        >
          <Text className="text-xs font-semibold text-white">Compare{canCompare ? ` (${compareList.length})` : ''}</Text>
        </Pressable>
      </View>
    </View>
  )
}
