import { StyleSheet, type StyleProp, type TextStyle } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { cssInterop } from 'nativewind'

// The inline heroicons the storefront account/auth pages draw (outline, stroke=currentColor).

type Def = { d: string[]; sw?: number; vb?: number; solid?: boolean }

const ICONS = {
  user: { d: ['M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'] },
  bag: { d: ['M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z'] },
  receipt: { d: ['M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z'] },
  location: {
    d: ['M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z', 'M15 11a3 3 0 11-6 0 3 3 0 016 0z'],
  },
  heart: {
    d: ['M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z'],
  },
  document: {
    d: ['M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2'],
  },
  refresh: { d: ['M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'] },
  gift: {
    d: ['M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7'],
  },
  userAdd: { d: ['M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z'] },
  camera: {
    d: [
      'M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z',
      'M15 13a3 3 0 11-6 0 3 3 0 016 0z',
    ],
  },
  logout: { d: ['M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1'] },
  search: { d: ['M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'] },
  photo: {
    d: ['M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z'],
  },
  chevronRight: { d: ['M9 5l7 7-7 7'] },
  chevronLeft: { d: ['M15 19l-7-7 7-7'] },
  chevronDown: { d: ['M19 9l-7 7-7-7'] },
  x: { d: ['M6 18L18 6M6 6l12 12'] },
  returnArrow: { d: ['M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6'] },
  clock: { d: ['M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'] },
  eye: {
    d: [
      'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
      'M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
    ],
  },
  warning: { d: ['M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z'] },
  calendar: { d: ['M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'] },
  cube: { d: ['M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4'] },
  checkCircle: { d: ['M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'] },
  info: { d: ['M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'] },
  alertCircle: { d: ['M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'] },
  plus: { d: ['M12 4v16m8-8H4'] },
  bolt: { d: ['M13 10V3L4 14h7v7l9-11h-7z'] },
  copy: {
    d: ['M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z'],
  },
  share: { d: ['M8.7 10.7l6.6-3.4m-6.6 6l6.6 3.4M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zm12 7a3 3 0 100-6 3 3 0 000 6z'] },
  check: { d: ['M5 13l4 4L19 7'] },
  mail: {
    sw: 1.5,
    d: [
      'M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75',
    ],
  },
  phone: {
    sw: 1.5,
    d: ['M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18h3'],
  },
  chat: {
    sw: 1.5,
    d: [
      'M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z',
    ],
  },
  checkCircleSolid: {
    vb: 20,
    solid: true,
    d: ['M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z'],
  },
  xCircleSolid: {
    vb: 20,
    solid: true,
    d: [
      'M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z',
    ],
  },
  whatsapp: {
    solid: true,
    d: [
      'M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2z',
    ],
  },
} satisfies Record<string, Def>

export type HeroIconName = keyof typeof ICONS

export default function HeroIcon({
  name,
  size = 16,
  color,
  strokeWidth,
}: {
  name: HeroIconName
  size?: number
  color: string
  strokeWidth?: number
}) {
  const def: Def = ICONS[name]
  const vb = def.vb ?? 24
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} fill="none">
      {def.d.map((d, i) =>
        def.solid ? (
          <Path key={i} d={d} fill={color} fillRule="evenodd" clipRule="evenodd" />
        ) : (
          <Path
            key={i}
            d={d}
            stroke={color}
            strokeWidth={strokeWidth ?? def.sw ?? 2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      )}
    </Svg>
  )
}

function StyledHeroIcon({ name, size, strokeWidth, style }: { name: HeroIconName; size?: number; strokeWidth?: number; style?: StyleProp<TextStyle> }) {
  return <HeroIcon name={name} size={size} strokeWidth={strokeWidth} color={(StyleSheet.flatten(style)?.color as string) ?? 'black'} />
}

/** HeroIcon coloured by a text-* className (dark: variants included), like the web's currentColor SVGs. */
export const TintIcon = cssInterop(StyledHeroIcon, { className: 'style' })

// Google "G" in its brand colours (the web inlines the same four paths).
const G_BLUE = 'rgb(66,133,244)'
const G_GREEN = 'rgb(52,168,83)'
const G_YELLOW = 'rgb(251,188,5)'
const G_RED = 'rgb(234,67,53)'

export function GoogleLogo({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill={G_BLUE} />
      <Path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill={G_GREEN} />
      <Path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill={G_YELLOW} />
      <Path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill={G_RED} />
    </Svg>
  )
}
