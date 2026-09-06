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
    <figure className={`rounded-xl overflow-hidden border border-border-default bg-surface-elevated shadow-2xl shadow-black/10 ${className}`}>
      <div className="flex items-center gap-1.5 px-4 h-9 bg-surface-secondary border-b border-border-default">
        <span className="w-3 h-3 rounded-full bg-red-400/70" />
        <span className="w-3 h-3 rounded-full bg-amber-400/70" />
        <span className="w-3 h-3 rounded-full bg-green-400/70" />
        <span className="ml-3 text-[11px] text-foreground-muted font-mono truncate">{caption}</span>
      </div>
      {children ? (
        <div className="overflow-hidden">{children}</div>
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="w-full block aspect-[16/9] object-cover object-top" />
      ) : (
        <div className="aspect-[16/10] flex flex-col items-center justify-center bg-gradient-to-br from-surface-secondary to-surface text-foreground-muted gap-3">
          <svg className="w-12 h-12 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
          </svg>
          <span className="text-xs font-medium">{alt}</span>
          <span className="text-[10px] uppercase tracking-widest opacity-60">Screenshot coming</span>
        </div>
      )}
    </figure>
  )
}
