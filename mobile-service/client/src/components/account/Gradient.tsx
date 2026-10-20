import { useId } from 'react'
import { StyleSheet, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

/** `bg-gradient-to-br from-X to-Y` drawn behind a box's content (absolute fill). */
export default function Gradient({
  from,
  to,
  fromOpacity = 1,
  toOpacity = 1,
  radius = 0,
}: {
  from: string
  to: string
  fromOpacity?: number
  toOpacity?: number
  radius?: number
}) {
  const id = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} stopOpacity={fromOpacity} />
            <Stop offset="1" stopColor={to} stopOpacity={toOpacity} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  )
}
