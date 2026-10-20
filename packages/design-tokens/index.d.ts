export type Scale = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, string>
export type Scheme = {
  surface: string; surfaceElevated: string; surfaceSecondary: string
  foreground: string; foregroundSecondary: string; foregroundMuted: string
  border: string; borderSecondary: string
  primary500: string; primary600: string; accent500: string; accent600: string
  cardShadow: string
}
export const primary: Scale
export const secondary: Scale
export const accent: Scale
export const schemes: { light: Scheme; dark: Scheme }
export const radius: { card: number; button: number; pill: number; hero: number }
export const fonts: { display: string; body: string }
export function cssVars(scheme: 'light' | 'dark'): Record<string, string>
