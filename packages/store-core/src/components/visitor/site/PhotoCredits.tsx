import { creditGroups, type StockCredit } from '@/lib/ai/stock-credits'

/**
 * The footer's credits line for stock photos ("Photos: A. Rao, S. Iyer on Pexels · K. Das on Pixabay"), each name and
 * library linked. Drawn by the site renderers (never by AI-written page code); nothing when no stock photo is shown.
 */
export default function PhotoCredits({
  credits,
  className,
  linkClassName = 'underline underline-offset-2 hover:opacity-80',
}: {
  credits?: (StockCredit | null | undefined)[] | null
  className?: string
  linkClassName?: string
}) {
  const groups = creditGroups(credits ?? [])
  if (!groups.length) return null
  const link = (href: string, label: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={linkClassName}>
      {label}
    </a>
  )
  return (
    <p className={className} data-photo-credits="">
      Photos:{' '}
      {groups.map((g, gi) => (
        <span key={g.source}>
          {gi > 0 && ' · '}
          {g.people.map((p, pi) => (
            <span key={`${p.name}:${pi}`}>
              {pi > 0 && ', '}
              {link(p.url, p.name)}
            </span>
          ))}{' '}
          on {link(g.url, g.label)}
        </span>
      ))}
    </p>
  )
}
