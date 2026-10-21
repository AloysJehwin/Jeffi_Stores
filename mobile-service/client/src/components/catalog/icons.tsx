import Svg, { Path, Rect } from 'react-native-svg'

// The heroicons the storefront's catalogue pages draw inline.

type P = { size?: number; color: string; strokeWidth?: number }

const stroke = (d: string, { size = 16, color, strokeWidth = 2 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
)

export const ChevronRightIcon = (p: P) => stroke('M9 5l7 7-7 7', p)
export const ChevronDownIcon = (p: P) => stroke('M19 9l-7 7-7-7', p)
export const CloseIcon = (p: P) => stroke('M6 18L18 6M6 6l12 12', p)
export const PlusIcon = (p: P) => stroke('M12 4v16m8-8H4', p)
export const FunnelIcon = (p: P) => stroke('M3 5h18l-7 8v5l-4 2v-7L3 5z', p)
export const SearchIcon = (p: P) => stroke('M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z', p)
export const PhotoIcon = (p: P) =>
  stroke('M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z', p)
export const InboxIcon = (p: P) =>
  stroke(
    'M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4',
    p
  )
export const TagIcon = (p: P) =>
  stroke('M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z', p)
export const CubeIcon = (p: P) => stroke('M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', p)

/** Solid check-circle (viewBox 20). */
export function CheckCircleIcon({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20">
      <Path
        fill={color}
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
      />
    </Svg>
  )
}

/** The checkbox tick (viewBox 10). */
export function TickIcon({ size = 10, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 10 10" fill="none">
      <Path d="M1.5 5L4 7.5 8.5 2.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

/** ProductGrid's 2x2 squares: outlined (group by category) or filled (grid view). */
export function SquaresIcon({ size = 14, color, filled = false }: { size?: number; color: string; filled?: boolean }) {
  const r = (x: number, y: number) => (
    <Rect
      x={x}
      y={y}
      width={6}
      height={6}
      rx={1}
      fill={filled ? color : 'none'}
      stroke={filled ? undefined : color}
      strokeWidth={filled ? undefined : 1.8}
      strokeLinejoin="round"
    />
  )
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      {r(1, 1)}
      {r(9, 1)}
      {r(1, 9)}
      {r(9, 9)}
    </Svg>
  )
}

export function TableIcon({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path d="M1 4h14M1 8h14M1 12h14M5 2v12M11 2v12" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  )
}
