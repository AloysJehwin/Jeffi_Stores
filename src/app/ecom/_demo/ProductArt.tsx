'use client'

import { ACCENT } from './theme'

type ProductArtProps = {
  category: string
  className?: string
}

export function categoryTint(category: string): string {
  switch (normalizeCategory(category)) {
    case 'Electronics':
      return ACCENT
    case 'Fashion':
      return '#6366f1'
    case 'Kitchen':
      return '#4f46e5'
    case 'Sports':
      return '#4338ca'
    case 'Home':
      return '#7c3aed'
    case 'Beauty':
      return '#818cf8'
    default:
      return ACCENT
  }
}

function normalizeCategory(category: string): string {
  const c = (category || '').trim().toLowerCase()
  if (c === 'electronics') return 'Electronics'
  if (c === 'fashion') return 'Fashion'
  if (c === 'kitchen') return 'Kitchen'
  if (c === 'sports') return 'Sports'
  if (c === 'home') return 'Home'
  if (c === 'beauty') return 'Beauty'
  return 'Other'
}

const INK = '#334155'
const MUTE = '#e2e8f0'
const PAPER = '#f8fafc'

export default function ProductArt({ category, className }: ProductArtProps) {
  const tint = categoryTint(category)
  const kind = normalizeCategory(category)
  return (
    <svg
      viewBox="0 0 240 240"
      width="100%"
      height="100%"
      role="img"
      aria-label={`${kind} illustration`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
    >
      <rect x="0" y="0" width="240" height="240" rx="20" fill={PAPER} />
      {kind === 'Electronics' && <Electronics tint={tint} />}
      {kind === 'Fashion' && <Fashion tint={tint} />}
      {kind === 'Kitchen' && <Kitchen tint={tint} />}
      {kind === 'Sports' && <Sports tint={tint} />}
      {kind === 'Home' && <Home tint={tint} />}
      {kind === 'Beauty' && <Beauty tint={tint} />}
      {kind === 'Other' && <Generic tint={tint} />}
    </svg>
  )
}

type PartProps = { tint: string }

function Electronics({ tint }: PartProps) {
  return (
    <g>
      <path d="M64 128 a56 56 0 0 1 112 0" fill="none" stroke={INK} strokeWidth="9" strokeLinecap="round" />
      <rect x="52" y="122" width="34" height="60" rx="14" fill={tint} />
      <rect x="154" y="122" width="34" height="60" rx="14" fill={tint} />
      <rect x="60" y="132" width="18" height="40" rx="9" fill={MUTE} />
      <rect x="162" y="132" width="18" height="40" rx="9" fill={PAPER} opacity="0.7" />
      <circle cx="120" cy="196" r="6" fill={INK} opacity="0.25" />
    </g>
  )
}

function Fashion({ tint }: PartProps) {
  return (
    <g>
      <path
        d="M90 56 L120 74 L150 56 L188 84 L172 108 L156 98 L156 188 L84 188 L84 98 L68 108 L52 84 Z"
        fill={tint}
        stroke={INK}
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <path d="M104 60 a16 16 0 0 0 32 0" fill={PAPER} stroke={INK} strokeWidth="6" strokeLinejoin="round" />
      <line x1="120" y1="96" x2="120" y2="176" stroke={PAPER} strokeWidth="4" opacity="0.6" />
    </g>
  )
}

function Kitchen({ tint }: PartProps) {
  return (
    <g>
      <ellipse cx="120" cy="150" rx="60" ry="16" fill={INK} opacity="0.12" />
      <path
        d="M66 118 h108 v20 a54 30 0 0 1 -108 0 Z"
        fill={tint}
        stroke={INK}
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <rect x="60" y="108" width="120" height="14" rx="7" fill={INK} />
      <rect x="174" y="120" width="42" height="12" rx="6" fill={INK} />
      <path d="M116 92 q-6 -14 6 -24" fill="none" stroke={MUTE} strokeWidth="5" strokeLinecap="round" />
      <path d="M128 92 q-6 -14 6 -24" fill="none" stroke={MUTE} strokeWidth="5" strokeLinecap="round" />
    </g>
  )
}

function Sports({ tint }: PartProps) {
  return (
    <g>
      <rect x="60" y="70" width="24" height="100" rx="8" fill={tint} />
      <rect x="156" y="70" width="24" height="100" rx="8" fill={tint} />
      <rect x="48" y="86" width="18" height="68" rx="7" fill={INK} />
      <rect x="174" y="86" width="18" height="68" rx="7" fill={INK} />
      <rect x="84" y="108" width="72" height="24" rx="10" fill={INK} />
      <rect x="90" y="114" width="60" height="12" rx="6" fill={MUTE} />
    </g>
  )
}

function Home({ tint }: PartProps) {
  return (
    <g>
      <path d="M92 60 h56 l22 44 h-100 Z" fill={tint} stroke={INK} strokeWidth="6" strokeLinejoin="round" />
      <rect x="112" y="104" width="16" height="70" fill={INK} />
      <rect x="88" y="174" width="64" height="16" rx="6" fill={INK} />
      <ellipse cx="120" cy="118" rx="40" ry="14" fill={tint} opacity="0.25" />
    </g>
  )
}

function Beauty({ tint }: PartProps) {
  return (
    <g>
      <path
        d="M92 118 h56 v46 a10 10 0 0 1 -10 10 h-36 a10 10 0 0 1 -10 -10 Z"
        fill={tint}
        stroke={INK}
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <rect x="104" y="92" width="32" height="30" rx="8" fill={MUTE} stroke={INK} strokeWidth="5" />
      <path d="M120 70 q-10 12 0 22 q10 -10 0 -22" fill={tint} opacity="0.6" />
      <circle cx="102" cy="70" r="5" fill={tint} opacity="0.5" />
      <circle cx="140" cy="64" r="4" fill={tint} opacity="0.4" />
    </g>
  )
}

function Generic({ tint }: PartProps) {
  return (
    <g>
      <rect x="72" y="82" width="96" height="80" rx="12" fill={tint} stroke={INK} strokeWidth="6" />
      <path d="M72 108 h96" stroke={PAPER} strokeWidth="6" />
      <rect x="104" y="70" width="32" height="18" rx="6" fill={INK} />
      <circle cx="120" cy="130" r="14" fill={PAPER} opacity="0.8" />
    </g>
  )
}
