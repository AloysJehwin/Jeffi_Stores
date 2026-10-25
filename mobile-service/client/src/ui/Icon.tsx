import { StyleSheet, type StyleProp, type TextStyle } from 'react-native'
import { cssInterop } from 'nativewind'
import type { IconComponent } from './Button'

function Tinted({ icon: Icon, size = 20, strokeWidth, style }: { icon: IconComponent; size?: number; strokeWidth?: number; style?: StyleProp<TextStyle> }) {
  return <Icon size={size} strokeWidth={strokeWidth} color={StyleSheet.flatten(style)?.color as string | undefined} />
}

/** A lucide icon coloured by a text-* class, so it follows dark: variants like the text beside it. */
export const TintedIcon = cssInterop(Tinted, { className: 'style' })
