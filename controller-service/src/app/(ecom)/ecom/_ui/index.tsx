import Link from 'next/link'
import type { ReactNode, ComponentProps } from 'react'

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`org-brown text-xs font-bold uppercase tracking-[0.18em] ${className}`}>{children}</div>
}

export function Display({ as: Tag = 'h2', children, className = '' }: { as?: 'h1' | 'h2' | 'h3'; children: ReactNode; className?: string }) {
  return <Tag className={`font-display font-black text-foreground leading-[1.05] tracking-tight ${className}`}>{children}</Tag>
}

type PillTone = 'solid' | 'sand' | 'ghost'
const PILL: Record<PillTone, string> = {
  solid: 'ecom-accent-bg text-white',
  sand: 'org-sand org-sand-hover text-foreground',
  ghost: 'org-brown hover:underline px-0',
}
export function Pill({ tone = 'solid', href, className = '', children, ...rest }: { tone?: PillTone; href?: string; className?: string; children: ReactNode } & Omit<ComponentProps<'button'>, 'children'>) {
  const cls = `inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-display font-bold transition-colors ${PILL[tone]} ${className}`
  if (href) return <Link href={href} className={cls}>{children}</Link>
  return <button className={cls} {...rest}>{children}</button>
}

export function SandCard({ children, className = '', tone = 'sand' }: { children: ReactNode; className?: string; tone?: 'sand' | 'peach' | 'terracotta' }) {
  const bg = tone === 'peach' ? 'org-peach' : tone === 'terracotta' ? 'ecom-accent-bg text-white' : 'org-sand'
  return <div className={`rounded-[2rem] p-7 ${bg} ${className}`}>{children}</div>
}

export function Dot({ tone = 'sage', className = '' }: { tone?: 'sage' | 'terracotta' | 'peach'; className?: string }) {
  if (tone === 'terracotta') return <span className={`inline-block w-3.5 h-3.5 rounded-full ecom-accent-bg ${className}`} />
  return (
    <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full ${tone === 'peach' ? 'org-peach' : 'org-sage'} ${className}`}>
      <span className="w-3 h-3 rounded-full" style={{ background: tone === 'peach' ? 'var(--org-terracotta)' : 'var(--org-sage-deep)' }} />
    </span>
  )
}

export function NumberBadge({ n, tone = 'peach', className = '' }: { n: ReactNode; tone?: 'peach' | 'sage'; className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center w-16 h-16 rounded-full font-display font-black text-xl org-brown ${tone === 'sage' ? 'org-sage' : 'org-peach'} ${className}`}>
      {n}
    </span>
  )
}

export { Segmented, ChoiceChips, ChoiceCards, SelectedMark, focusRing, fieldCls, currentRowCls, choiceCardCls, type Choice } from './choice'
