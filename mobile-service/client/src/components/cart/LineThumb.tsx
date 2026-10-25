import { View } from 'react-native'
import { Image } from 'expo-image'
import { ImageIcon } from 'lucide-react-native'
import { useTokens } from '../../theme'

/** Square line-item thumbnail (object-cover) with the web's image placeholder. */
export default function LineThumb({ uri, blurhash, size, iconSize }: { uri?: string | null; blurhash?: string | null; size: number; iconSize: number }) {
  const t = useTokens()
  return (
    <View className="shrink-0 overflow-hidden rounded-xl border border-border-default bg-surface" style={{ width: size, height: size }}>
      {uri ? (
        <Image
          source={{ uri }}
          placeholder={blurhash ? { blurhash } : undefined}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          transition={150}
          recyclingKey={uri}
        />
      ) : (
        <View className="flex-1 items-center justify-center">
          <ImageIcon size={iconSize} color={t.foregroundMuted} strokeWidth={1} />
        </View>
      )}
    </View>
  )
}
