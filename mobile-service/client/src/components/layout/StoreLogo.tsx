import { useState } from 'react'
import { View } from 'react-native'
import { Image } from 'expo-image'
import { Text } from '../../ui'

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

/** `<img className="h-N w-auto">` — the store logo, round, initials when there is none. */
export function StoreLogo({ uri, name, size }: { uri: string | null; name: string; size: number }) {
  const [aspect, setAspect] = useState(1)
  if (!uri) {
    if (!name) return null
    return (
      <View className="bg-accent-500 items-center justify-center" style={{ width: size, height: size, borderRadius: size / 2 }}>
        <Text className="text-white font-bold" style={{ fontSize: size * 0.38 }}>{initials(name)}</Text>
      </View>
    )
  }
  const round = Math.abs(aspect - 1) < 0.05
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={`${name} Logo`}
      contentFit="contain"
      onLoad={e => e.source.height && setAspect(e.source.width / e.source.height)}
      style={{ height: size, width: size * aspect, borderRadius: round ? size / 2 : 0 }}
    />
  )
}
