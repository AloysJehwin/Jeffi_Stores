import { View, ActivityIndicator } from 'react-native'

interface SpinnerProps {
  size?: 'small' | 'large'
  color?: string
}

export default function Spinner({ size = 'large', color = '#7cb900' }: SpinnerProps) {
  return (
    <View className="flex-1 items-center justify-center py-8">
      <ActivityIndicator size={size} color={color} />
    </View>
  )
}
