import { useId, type ReactNode } from 'react'
import { Pressable } from 'react-native'
import { Text } from '../../ui'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { primary } from '../../theme'

export const SHADOW_SM = '0 1px 2px 0 rgba(0, 0, 0, 0.05)'

/** bg-gradient-to-r from-primary-600 to-primary-800, filling a rounded, overflow-hidden parent. */
export function PrimaryGradient() {
  const id = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <Svg style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={primary[600]} />
          <Stop offset="1" stopColor={primary[800]} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  )
}

/** A solid rounded-lg button (the pages' Contact Support / Sign In links). */
export function SolidButton({
  label,
  onPress,
  className = 'bg-primary-500 active:bg-primary-600 px-6 py-2.5',
  textClassName = 'text-sm font-semibold text-white',
  children,
}: {
  label: string
  onPress: () => void
  className?: string
  textClassName?: string
  children?: ReactNode
}) {
  return (
    <Pressable onPress={onPress} className={`flex-row items-center justify-center gap-2 self-center rounded-lg ${className}`}>
      <Text className={textClassName}>{label}</Text>
      {children}
    </Pressable>
  )
}
