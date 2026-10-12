import type { ReactNode } from 'react'

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-border-default bg-surface-elevated p-6 ${className}`}>
      {title && <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">{title}</h2>}
      {children}
    </section>
  )
}

export function Row({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-foreground-secondary flex-shrink-0">{label}</span>
      <span className={`text-foreground text-right ${mono ? 'font-mono text-xs break-all' : 'font-medium'}`}>{value}</span>
    </div>
  )
}
