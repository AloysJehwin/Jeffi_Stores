import type { ViewStyle } from 'react-native'
import { useColorScheme } from 'nativewind'

// Shadows in light mode; dark surfaces separate with a border instead (shadows vanish on dark grey).
export type Elevation = 'none' | 'raised' | 'overlay' | 'floating'

const SHADOW: Record<Exclude<Elevation, 'none'>, string> = {
  raised: '0 1px 3px 0 rgba(0,0,0,0.08), 0 1px 2px -1px rgba(0,0,0,0.06)',
  overlay: '0 8px 24px -6px rgba(0,0,0,0.16), 0 2px 6px -2px rgba(0,0,0,0.08)',
  floating: '0 16px 40px -8px rgba(0,0,0,0.24), 0 4px 12px -4px rgba(0,0,0,0.12)',
}

/** Style for an elevated surface; pair with `elevationClass` for the dark-mode border. */
export function useElevation(level: Elevation): ViewStyle {
  const { colorScheme } = useColorScheme()
  if (level === 'none' || colorScheme === 'dark') return {}
  return { boxShadow: SHADOW[level] }
}

// The border is always there, clear in light mode: on Android, removing a clipping view's border width
// (dark→light) left its children clipped to nothing, blanking every list card until it remounted.
export function elevationClass(level: Elevation): string {
  return level === 'none' ? '' : 'border border-transparent dark:border-border-default'
}
