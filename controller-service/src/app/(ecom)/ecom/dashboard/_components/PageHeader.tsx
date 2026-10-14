import type { ReactNode } from 'react'

export default function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: string
  eyebrow?: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
      <div className="min-w-0">
        {eyebrow && <div className="text-xs font-semibold uppercase tracking-widest text-foreground-muted mb-1">{eyebrow}</div>}
        <h1 className="font-display text-3xl sm:text-4xl font-black text-foreground leading-tight">{title}</h1>
        {description && <p className="text-sm text-foreground-secondary mt-2 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  )
}
