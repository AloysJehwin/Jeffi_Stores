import { StyleSheet, type StyleProp, type TextStyle } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { cssInterop } from 'nativewind'
import type { LucideIcon } from 'lucide-react-native'

// Icons coloured by a text-* className, like the web's `<svg stroke="currentColor" className="text-…">`.

type Base = { size?: number; strokeWidth?: number; style?: StyleProp<TextStyle> }

const colorOf = (style?: StyleProp<TextStyle>) => StyleSheet.flatten(style)?.color as string | undefined

/** The web's inline outline SVGs (24×24 heroicon paths). */
function PathIcon({ d, size = 24, strokeWidth = 2, style }: Base & { d: string | string[] }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={colorOf(style)}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {(Array.isArray(d) ? d : [d]).map((p, i) => (
        <Path key={i} d={p} />
      ))}
    </Svg>
  )
}

function LucideTinted({ icon: Icon, size = 24, strokeWidth = 2, style }: Base & { icon: LucideIcon }) {
  return <Icon size={size} strokeWidth={strokeWidth} color={colorOf(style)} />
}

export const Glyph = cssInterop(PathIcon, { className: 'style' })
export const TintedIcon = cssInterop(LucideTinted, { className: 'style' })

// Heroicon paths the info pages share.
export const CHEVRON_RIGHT = 'M9 5l7 7-7 7'
export const CHEVRON_LEFT = 'M15 19l-7-7 7-7'
export const CHEVRON_DOWN = 'M19 9l-7 7-7-7'
export const DOWNLOAD = 'M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3'
export const CHAT =
  'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z'
export const DOCUMENT =
  'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
