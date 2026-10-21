// The admin's badge colour picker (HeroSlideManager / OfferSlideDisplayEditor BADGE_COLORS). Literal
// strings so NativeWind compiles them; a value outside the list falls back to accent.
const BADGE_BG: Record<string, string> = {
  'bg-primary-500': 'bg-primary-500',
  'bg-accent-500': 'bg-accent-500',
  'bg-red-500': 'bg-red-500',
  'bg-blue-600': 'bg-blue-600',
  'bg-emerald-600': 'bg-emerald-600',
  'bg-orange-600': 'bg-orange-600',
  'bg-purple-600': 'bg-purple-600',
  'bg-rose-600': 'bg-rose-600',
  'bg-teal-600': 'bg-teal-600',
  'bg-yellow-600': 'bg-yellow-600',
}

export function badgeBg(cls: string | null | undefined, fallback = 'bg-accent-500'): string {
  return (cls && BADGE_BG[cls.trim()]) || fallback
}
