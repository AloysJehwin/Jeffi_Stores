interface ProductWarningBadgesProps {
  fragile?: boolean | null
  hazardous?: boolean | null
  flammable?: boolean | null
  size?: 'sm' | 'xs'
}

const FlameShape = () => (
  <svg viewBox="0 0 10 14" fill="currentColor" style={{ width: '0.6em', height: '0.85em', display: 'inline', verticalAlign: 'middle' }}>
    <path d="M5 0C5 0 2 4 2 7a3 3 0 006 0c0-.5-.1-1-.25-1.4.5.8.75 1.7.75 2.9a4 4 0 01-8 0C.5 5 5 0 5 0zm0 3C4.3 4.5 3.5 6 3.5 7.5a1.5 1.5 0 003 0C6.5 6.3 5.8 4.8 5 3z" />
  </svg>
)

const TriangleExclaim = () => (
  <svg viewBox="0 0 12 12" fill="currentColor" style={{ width: '0.65em', height: '0.65em', display: 'inline', verticalAlign: 'middle' }}>
    <path d="M6 1L11.5 11H.5L6 1zm0 2.5L2.2 10h7.6L6 3.5zM5.4 6h1.2v2.5H5.4V6zm0 3h1.2v1.2H5.4V9z" />
  </svg>
)

const DiamondBreak = () => (
  <svg viewBox="0 0 12 12" fill="currentColor" style={{ width: '0.65em', height: '0.65em', display: 'inline', verticalAlign: 'middle' }}>
    <path d="M6 .5L11.5 6 6 11.5.5 6 6 .5zm0 2L2.5 6l1.8 1.8L5.5 6l1.5 2 1-2 .8 1.8L10.5 6 6 2.5z" />
  </svg>
)

export default function ProductWarningBadges({ fragile, hazardous, flammable, size = 'sm' }: ProductWarningBadgesProps) {
  const badges = [
    flammable && { key: 'flammable', label: 'FLAMMABLE', Icon: FlameShape,      color: 'bg-red-600 text-white' },
    hazardous && { key: 'hazardous', label: 'HAZARDOUS', Icon: TriangleExclaim, color: 'bg-orange-500 text-white' },
    fragile   && { key: 'fragile',   label: 'FRAGILE',   Icon: DiamondBreak,    color: 'bg-blue-600 text-white' },
  ].filter(Boolean) as { key: string; label: string; Icon: () => JSX.Element; color: string }[]

  if (badges.length === 0) return null

  const cls = size === 'xs'
    ? 'px-1 py-0.5 text-[8px] font-bold rounded gap-0.5'
    : 'px-1.5 py-0.5 text-[10px] font-bold rounded gap-1'

  return (
    <div className="flex flex-wrap gap-1">
      {badges.map(({ key, label, Icon, color }) => (
        <span key={key} className={`inline-flex items-center ${cls} ${color}`}>
          <Icon />{label}
        </span>
      ))}
    </div>
  )
}
