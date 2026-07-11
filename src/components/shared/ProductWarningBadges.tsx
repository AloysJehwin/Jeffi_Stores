interface ProductWarningBadgesProps {
  fragile?: boolean | null
  hazardous?: boolean | null
  flammable?: boolean | null
  size?: 'sm' | 'xs'
}

const FlameIcon = ({ className }: { className: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2C12 2 8 6.5 8 10a4 4 0 0 0 8 0c0-.6-.1-1.2-.3-1.7.7 1 1.3 2.2 1.3 3.7a5 5 0 0 1-10 0C7 7.5 12 2 12 2zm0 3.5C11 7 9.5 9 9.5 11.5a2.5 2.5 0 0 0 5 0C14.5 10 13.5 8.5 12 5.5z" />
  </svg>
)

const ExclamationDiamondIcon = ({ className }: { className: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 1L1 12l11 11 11-11L12 1zm0 3.83L19.17 12 12 19.17 4.83 12 12 4.83zM11 8v5h2V8h-2zm0 6v2h2v-2h-2z" />
  </svg>
)

const BrokenGlassIcon = ({ className }: { className: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 2l1.5 6-2.5 2 3 2-1 3h6l-1-3 3-2-2.5-2L16 2H8zm1.8 2h4.4l1 4-1.5 1.2 1.3 1-1 2.8H9.9l-1-2.8 1.4-1-1.5-1.2.8-4z" />
    <path d="M10 18v4h4v-4h-4z" />
    <path d="M10 18h4l.5-1.5h-5L10 18z" />
    <line x1="6" y1="3" x2="18" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)

export default function ProductWarningBadges({ fragile, hazardous, flammable, size = 'sm' }: ProductWarningBadgesProps) {
  const badges = [
    fragile   && { key: 'fragile',   label: 'Fragile',   Icon: BrokenGlassIcon,      color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700' },
    hazardous && { key: 'hazardous', label: 'Hazardous', Icon: ExclamationDiamondIcon, color: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-700' },
    flammable && { key: 'flammable', label: 'Flammable', Icon: FlameIcon,              color: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700' },
  ].filter(Boolean) as { key: string; label: string; Icon: typeof FlameIcon; color: string }[]

  if (badges.length === 0) return null

  const iconSize = size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5'
  const textSize = size === 'xs' ? 'text-[9px]' : 'text-[10px]'
  const padding  = size === 'xs' ? 'px-1 py-0.5' : 'px-1.5 py-0.5'

  return (
    <div className="flex flex-wrap gap-1">
      {badges.map(({ key, label, Icon, color }) => (
        <span key={key} className={`inline-flex items-center gap-0.5 ${padding} rounded border font-semibold ${textSize} ${color}`}>
          <Icon className={iconSize} />
          {label}
        </span>
      ))}
    </div>
  )
}
