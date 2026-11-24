import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { primaryBtn } from '../../onboard/ui'

const isLink = (a: unknown): a is { href: string; label: string } => !!a && typeof a === 'object' && 'href' in a && 'label' in a

/**
 * The console's one empty state: what is missing, why, and a link to the next step. Inside a Card by default;
 * `bare` drops the frame for one that is already inside a card or table.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  bare = false,
}: {
  icon?: LucideIcon
  title: string
  children?: ReactNode
  action?: { href: string; label: string } | ReactNode
  bare?: boolean
}) {
  const link = isLink(action) ? action : null
  return (
    <div className={`flex flex-col items-center px-6 py-12 text-center ${bare ? '' : 'rounded-2xl border border-border-default bg-surface-elevated'}`}>
      {Icon && (
        <span className="org-sand mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full">
          <Icon className="h-5 w-5 text-foreground-secondary" aria-hidden />
        </span>
      )}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {children && <div className="mt-1.5 max-w-md text-sm text-foreground-secondary">{children}</div>}
      {action && (
        <div className="mt-5">
          {link ? (
            <Link href={link.href} className={primaryBtn}>
              {link.label}
            </Link>
          ) : (
            (action as ReactNode)
          )}
        </div>
      )}
    </div>
  )
}
