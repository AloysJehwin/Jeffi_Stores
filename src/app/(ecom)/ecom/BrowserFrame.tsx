import { ReactNode } from 'react'

export function BrowserFrame({
  src,
  alt,
  caption,
  className = '',
  children,
}: {
  src?: string
  alt: string
  caption: string
  className?: string
  children?: ReactNode
}) {
  return (
    <figure className={`rounded-[2rem] overflow-hidden org-chrome shadow-2xl shadow-black/10 ${className}`}>
      <div className="flex items-center gap-2 px-5 h-14">
        <span className="w-3.5 h-3.5 rounded-full" style={{ background: 'var(--org-terracotta)' }} />
        <span className="w-3.5 h-3.5 rounded-full" style={{ background: 'var(--org-apricot)' }} />
        <span className="w-3.5 h-3.5 rounded-full" style={{ background: 'var(--org-sage-deep)', opacity: 0.6 }} />
        <span className="ml-3 flex-1 max-w-[340px] truncate rounded-full bg-surface-elevated px-4 py-1.5 text-xs font-mono text-foreground-secondary">
          {caption}
        </span>
      </div>
      {children ? (
        <div className="overflow-hidden org-frame rounded-t-[1.75rem]">{children}</div>
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="w-full block aspect-[16/9] object-cover object-top" />
      ) : (
        <div className="aspect-[16/10] flex flex-col items-center justify-center org-frame text-foreground-muted gap-3">
          <span className="text-xs font-medium">{alt}</span>
          <span className="text-[10px] uppercase tracking-widest opacity-60">Screenshot coming</span>
        </div>
      )}
    </figure>
  )
}
