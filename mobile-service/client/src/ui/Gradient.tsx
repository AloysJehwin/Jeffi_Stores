import { useId } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

/** offset 0–1, colour (a token), opacity (default 1). */
export type GradientStop = readonly [offset: number, color: string, opacity?: number]
export type GradientDir = 'r' | 'l' | 'b' | 't' | 'br'

// bg-gradient-to-{dir} as an svg vector.
const VECTOR: Record<GradientDir, readonly [string, string, string, string]> = {
  r: ['0', '0', '1', '0'],
  l: ['1', '0', '0', '0'],
  b: ['0', '0', '0', '1'],
  t: ['0', '1', '0', '0'],
  br: ['0', '0', '1', '1'],
}

/**
 * A linear gradient that ignores touches: image scrims, tinted card backgrounds, edge fades. It fills its
 * parent unless `style` positions it.
 */
export function Gradient({
  stops,
  dir = 'br',
  radius,
  style,
}: {
  stops: readonly GradientStop[]
  dir?: GradientDir
  radius?: number
  style?: StyleProp<ViewStyle>
}) {
  const id = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [x1, y1, x2, y2] = VECTOR[dir]
  return (
    <View
      pointerEvents="none"
      style={[style ? { position: 'absolute' } : StyleSheet.absoluteFill, radius != null && { borderRadius: radius, overflow: 'hidden' }, style]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
            {stops.map(([offset, color, opacity = 1], i) => (
              <Stop key={i} offset={offset} stopColor={color} stopOpacity={opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  )
}
