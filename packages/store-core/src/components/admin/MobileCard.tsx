import type { ReactNode } from 'react'

interface MobileCardProps {
  children: ReactNode
  accent?: boolean
  onClick?: () => void
  className?: string
}

export default function MobileCard({ children, accent, onClick, className = '' }: MobileCardProps) {
  const base = `bg-surface-elevated rounded-lg shadow-sm border p-4 ${accent ? 'border-yellow-400 dark:border-yellow-600' : 'border-border-default'}`
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${base} w-full text-left ${className}`}>
        {children}
      </button>
    )
  }
  return <div className={`${base} ${className}`}>{children}</div>
}
