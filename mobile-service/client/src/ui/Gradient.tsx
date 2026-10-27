import { StyleSheet, View, processColor, type StyleProp, type ViewStyle } from 'react-native'

/** offset 0–1, colour (a token), opacity (default 1). */
export type GradientStop = readonly [offset: number, color: string, opacity?: number]
export type GradientDir = 'r' | 'l' | 'b' | 't' | 'br'

const DIRECTION: Record<GradientDir, string> = { r: 'to right', l: 'to left', b: 'to bottom', t: 'to top', br: 'to bottom right' }

/** A colour token at an opacity, as css rgba(). */
export function rgba(color: string, opacity = 1): string {
  const n = processColor(color)
  if (typeof n !== 'number') return color
  const a = ((n >>> 24) & 255) / 255
  return `rgba(${(n >>> 16) & 255}, ${(n >>> 8) & 255}, ${n & 255}, ${+(a * opacity).toFixed(3)})`
}

/** css linear-gradient() for `experimental_backgroundImage`. */
export function linearGradient(stops: readonly GradientStop[], dir: GradientDir = 'br'): string {
  return `linear-gradient(${DIRECTION[dir]}, ${stops.map(([offset, color, opacity = 1]) => `${rgba(color, opacity)} ${offset * 100}%`).join(', ')})`
}

/**
 * A linear gradient that ignores touches: image scrims, tinted card backgrounds, edge fades. It fills its
 * parent unless `style` positions it. Drawn natively (a GPU shader); an svg would rasterise a bitmap the
 * size of the view on the UI thread each time it mounts, which stalls scrolling over large cards.
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
  return (
    <View
      pointerEvents="none"
      style={[
        style ? { position: 'absolute' } : StyleSheet.absoluteFill,
        { experimental_backgroundImage: linearGradient(stops, dir) },
        radius != null && { borderRadius: radius },
        style,
      ]}
    />
  )
}
