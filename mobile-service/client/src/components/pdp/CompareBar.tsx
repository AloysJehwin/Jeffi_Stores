import { View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ImageIcon, Plus, X } from 'lucide-react-native'
import { Button, IconButton, TextButton, elevationClass, useElevation } from '../../ui'
import { useCompareStore } from '../../stores/compareStore'
import { status, useTokens } from '../../theme'

// Mirror of controller-service components/visitor/CompareBar.tsx (fixed bottom bar once 2+ products are queued).

export default function CompareBar() {
  const router = useRouter()
  const t = useTokens()
  const insets = useSafeAreaInsets()
  const shadow = useElevation('floating')
  const { compareList, removeFromCompare, clearCompare } = useCompareStore()
  if (compareList.length < 2) return null

  return (
    <View
      className={`absolute bottom-0 left-0 right-0 z-30 border-t border-border-default bg-surface-elevated ${elevationClass('floating')}`}
      style={[shadow, { paddingBottom: insets.bottom }]}
    >
      <View className="flex-row items-center gap-3 px-4 py-3">
        <View className="min-w-0 flex-1 flex-row items-center gap-2 overflow-hidden">
          {compareList.map(p => (
            <View key={p.id} className="relative shrink-0">
              <View className="h-12 w-12 overflow-hidden rounded-xl border border-border-default bg-surface-secondary">
                {p.image ? (
                  <Image source={{ uri: p.image }} style={{ flex: 1, margin: 4 }} contentFit="contain" accessibilityLabel={p.name} />
                ) : (
                  <View className="h-full w-full items-center justify-center">
                    <ImageIcon size={20} strokeWidth={1} color={t.foregroundMuted} />
                  </View>
                )}
              </View>
              <IconButton
                icon={X}
                label={`Remove ${p.name}`}
                size="xs"
                color={status.white}
                onPress={() => removeFromCompare(p.id)}
                className="absolute -right-2.5 -top-2.5 rounded-full bg-red-500"
              />
            </View>
          ))}
          {compareList.length < 4 ? (
            <View className="h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-dashed border-border-default">
              <Plus size={20} strokeWidth={1.5} color={t.foregroundMuted} />
            </View>
          ) : null}
        </View>
        <View className="shrink-0 flex-row items-center gap-2">
          <TextButton label="Clear" tone="muted" onPress={clearCompare} />
          <Button
            label="Compare Now"
            size="sm"
            block={false}
            onPress={() => router.push({ pathname: '/compare', params: { ids: compareList.map(p => p.id).join(',') } })}
          />
        </View>
      </View>
    </View>
  )
}
