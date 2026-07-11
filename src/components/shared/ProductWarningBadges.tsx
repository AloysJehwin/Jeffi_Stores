interface ProductWarningBadgesProps {
  fragile?: boolean | null
  hazardous?: boolean | null
  flammable?: boolean | null
  size?: 'sm' | 'xs'
}

export default function ProductWarningBadges({ fragile, hazardous, flammable, size = 'sm' }: ProductWarningBadgesProps) {
  const badges = [
    flammable && { key: 'flammable', label: '🔥 FLAMMABLE', color: 'bg-red-600 text-white' },
    hazardous && { key: 'hazardous', label: '⚠ HAZARDOUS', color: 'bg-orange-500 text-white' },
    fragile   && { key: 'fragile',   label: '🫙 FRAGILE',   color: 'bg-blue-600 text-white' },
  ].filter(Boolean) as { key: string; label: string; color: string }[]

  if (badges.length === 0) return null

  const cls = size === 'xs'
    ? 'px-1 py-0.5 text-[8px] font-bold rounded'
    : 'px-1.5 py-0.5 text-[10px] font-bold rounded'

  return (
    <div className="flex flex-wrap gap-1">
      {badges.map(({ key, label, color }) => (
        <span key={key} className={`inline-flex items-center ${cls} ${color}`}>{label}</span>
      ))}
    </div>
  )
}
