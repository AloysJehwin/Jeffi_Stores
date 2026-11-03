import type { ReactNode } from 'react'

/** Header on top, the conversation filling the middle, the composer pinned at the bottom. */
export default function ChatShell({ header, banner, children, composer, className = '' }: { header?: ReactNode; banner?: ReactNode; children: ReactNode; composer?: ReactNode; className?: string }) {
  return (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden bg-surface ${className}`}>
      {header && <div className="shrink-0">{header}</div>}
      {banner && <div className="shrink-0">{banner}</div>}
      {children}
      {composer}
    </div>
  )
}
