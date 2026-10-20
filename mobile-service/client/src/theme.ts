// Imperative access to the shared tokens (StyleSheet values, icon colours, navigation themes). For
// className styling use the semantic Tailwind classes instead — they follow the colour scheme on their own.
import { useColorScheme } from 'nativewind'
import tokens from '../../../packages/design-tokens'

export const { primary, secondary, accent, schemes, status, radius } = tokens
export type Scheme = typeof schemes.light

export const fonts = { bebas: 'BebasNeue-Regular', inter: 'Inter' }

/** The token set for the current colour scheme. */
export function useTokens(): Scheme {
  const { colorScheme } = useColorScheme()
  return colorScheme === 'dark' ? schemes.dark : schemes.light
}
