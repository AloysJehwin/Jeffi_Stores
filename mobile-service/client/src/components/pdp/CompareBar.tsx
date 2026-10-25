import { Pressable, View } from 'react-native'
import { Text } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Glyph, P } from './Glyph'
import { useCompareStore } from '../../stores/compareStore'

// Mirror of controller-service components/visitor/CompareBar.tsx (fixed bottom bar once 2+ products are queued).

export default function CompareBar() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { compareList, removeFromCompare, clearCompare } = useCompareStore()
  if (compareList.length < 2) return null

  return (
    <View
      className="absolute bottom-0 left-0 right-0 z-30 border-t border-border-default bg-surface-elevated shadow-2xl"
      style={{ paddingBottom: insets.bottom }}
    >
      <View className="flex-row items-center gap-3 px-4 py-3">
        <View className="min-w-0 flex-1 flex-row items-center gap-2 overflow-hidden">
          {compareList.map(p => (
            <View key={p.id} className="relative shrink-0">
              <View className="h-12 w-12 overflow-hidden rounded-lg border border-border-default bg-surface-secondary">
                {p.image ? (
                  <Image source={{ uri: p.image }} style={{ flex: 1, margin: 4 }} contentFit="contain" accessibilityLabel={p.name} />
                ) : (
                  <View className="h-full w-full items-center justify-center">
                    <Glyph d={P.photo} size={20} strokeWidth={1} className="text-foreground-muted" />
                  </View>
                )}
              </View>
              <Pressable
                onPress={() => removeFromCompare(p.id)}
                hitSlop={6}
                accessibilityLabel={`Remove ${p.name}`}
                className="absolute -right-1.5 -top-1.5 h-5 w-5 items-center justify-center rounded-full bg-red-500 shadow"
              >
                <Glyph d={P.close} size={12} strokeWidth={2.5} className="text-white" />
              </Pressable>
            </View>
          ))}
          {compareList.length < 4 ? (
            <View className="h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-border-default">
              <Glyph d={P.plus} size={20} strokeWidth={1.5} className="text-foreground-muted" />
            </View>
          ) : null}
        </View>
        <View className="shrink-0 flex-row items-center gap-2">
          <Pressable onPress={clearCompare} className="px-2 py-1.5">
            <Text className="text-xs text-foreground-muted">Clear</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push({ pathname: '/compare', params: { ids: compareList.map(p => p.id).join(',') } })}
            className="rounded-lg bg-accent-500 px-4 py-2"
          >
            <Text className="text-sm font-semibold text-white">Compare Now</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}
