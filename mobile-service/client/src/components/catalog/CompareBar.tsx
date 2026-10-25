import { Pressable, ScrollView, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ImageIcon, Plus, X } from 'lucide-react-native'
import { Button, Text, TextButton, elevationClass, useElevation } from '../../ui'
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
  // The badge is too small to tap on its own, so the whole thumbnail removes (hover-revealed on the web).
  return (
    <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel={`Remove ${p.name} from compare`} className="relative shrink-0 active:opacity-70">
      <View className={`overflow-hidden rounded-xl border ${bordered}`} style={{ width: size, height: size }}>
        {src ? (
          <Image source={{ uri: src }} contentFit="contain" style={{ flex: 1, margin: size > 40 ? 4 : 2 }} />
        ) : (
          <View className="flex-1 items-center justify-center">
            <ImageIcon size={size > 40 ? 20 : 16} strokeWidth={1.5} color={t.foregroundMuted} />
          </View>
        )}
      </View>
      <View
        pointerEvents="none"
        className={`absolute items-center justify-center rounded-full bg-red-600 ${size > 40 ? '-right-1.5 -top-1.5 h-5 w-5' : '-right-1 -top-1 h-4 w-4'}`}
      >
        <X size={size > 40 ? 12 : 10} strokeWidth={3} color={status.white} />
      </View>
    </Pressable>
  )
}

export default function CompareBar() {
  const t = useTokens()
  const insets = useSafeAreaInsets()
  const shadow = useElevation('floating')
  const { compareList, removeFromCompare, clearCompare } = useCompareStore()
  const open = useOpenCompare()
  if (compareList.length < 2) return null

  return (
    <View
      className={`absolute bottom-0 left-0 right-0 z-30 rounded-t-sheet border-t border-border-default bg-surface-elevated ${elevationClass('floating')}`}
      style={[shadow, { paddingBottom: insets.bottom }]}
    >
      <View className="flex-row items-center gap-3 px-4 py-3">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="min-w-0 flex-1" contentContainerStyle={{ gap: 8, paddingTop: 6, paddingRight: 6 }}>
          {compareList.map(p => (
            <Thumb key={p.id} p={p} size={48} bordered="border-border-default bg-surface-secondary" onRemove={() => removeFromCompare(p.id)} />
          ))}
          {compareList.length < 4 ? (
            <View className="h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-dashed border-border-default">
              <Plus size={20} strokeWidth={1.5} color={t.foregroundMuted} />
            </View>
          ) : null}
        </ScrollView>

        <View className="shrink-0 flex-row items-center gap-3">
          <TextButton label="Clear" tone="muted" onPress={clearCompare} />
          <Button label="Compare Now" size="sm" block={false} onPress={() => open(compareList)} />
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
    <View className="mb-6 flex-row items-center gap-3 rounded-panel border border-accent-200 bg-accent-50 p-3 dark:border-accent-800 dark:bg-accent-900/20">
      <View className="min-w-0 flex-1 flex-row items-center gap-2">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="shrink" contentContainerStyle={{ gap: 6, paddingTop: 4, paddingRight: 4 }}>
          {compareList.map(p => (
            <Thumb key={p.id} p={p} size={40} bordered="border-accent-200 bg-surface dark:border-accent-700" onRemove={() => removeFromCompare(p.id)} />
          ))}
          {Array.from({ length: Math.max(0, 2 - compareList.length) }).map((_, i) => (
            <View
              key={`empty-${i}`}
              className="h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-accent-300 dark:border-accent-700"
            >
              <Plus size={14} color={accent[400]} />
            </View>
          ))}
        </ScrollView>
        <Text className="text-xs text-accent-600 dark:text-accent-400">{compareList.length} / 4</Text>
      </View>

      <View className="shrink-0 flex-row items-center gap-3">
        <TextButton label="Clear" onPress={clearCompare} />
        <Button
          label={`Compare${canCompare ? ` (${compareList.length})` : ''}`}
          size="sm"
          block={false}
          disabled={!canCompare}
          onPress={() => canCompare && open(compareList)}
        />
      </View>
    </View>
  )
}
