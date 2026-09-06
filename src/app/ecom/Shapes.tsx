// Decorative SVG shapes + device mockups for the ecom landing. No emojis anywhere —
// all icons/accents are inline SVG so they respect currentColor and the theme.

// A phone frame with an illustrated in-screen UI (shapes, not a real screenshot).
// Used in the bento section for a lively, product-y feel.
export function PhoneMock({ variant = 'store', src, alt = '', className = '' }: { variant?: 'store' | 'chart' | 'card'; src?: string; alt?: string; className?: string }) {
  return (
    <div className={`relative mx-auto w-[190px] ${className}`}>
      <div className={`rounded-[2rem] border-[6px] border-foreground/80 bg-surface-elevated shadow-2xl overflow-hidden ${src ? 'aspect-[390/844]' : 'aspect-[9/19]'}`}>
        {src ? (
          <img src={src} alt={alt} className="w-full h-full object-cover object-top" />
        ) : (
        <>
        {/* notch */}
        <div className="h-6 flex items-center justify-center">
          <span className="w-16 h-1.5 rounded-full bg-foreground/20" />
        </div>
        <div className="px-3 pb-3 space-y-2.5">
          {variant === 'store' && (
            <>
              <div className="h-20 rounded-xl bg-gradient-to-br from-accent-500/80 to-primary-500/80" />
              <div className="grid grid-cols-2 gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="rounded-lg border border-border-default p-2 space-y-1">
                    <div className="h-8 rounded bg-surface-secondary" />
                    <div className="h-1.5 w-3/4 rounded bg-foreground/10" />
                    <div className="h-1.5 w-1/2 rounded bg-accent-500/40" />
                  </div>
                ))}
              </div>
            </>
          )}
          {variant === 'chart' && (
            <>
              <div className="rounded-xl border border-border-default p-2.5">
                <div className="h-1.5 w-1/3 rounded bg-foreground/10 mb-2" />
                <div className="h-16 flex items-end gap-1">
                  {[40, 65, 50, 80, 60, 90, 70].map((h, i) => (
                    <div key={i} className="flex-1 rounded-t bg-accent-500/70" style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-border-default p-2.5 space-y-1.5">
                <div className="h-1.5 w-2/3 rounded bg-foreground/10" />
                <div className="h-1.5 w-1/2 rounded bg-foreground/10" />
              </div>
            </>
          )}
          {variant === 'card' && (
            <>
              <div className="rounded-xl bg-gradient-to-br from-accent-600 to-primary-600 p-3 h-24 flex flex-col justify-between">
                <div className="h-4 w-8 rounded bg-white/40" />
                <div className="h-2 w-3/4 rounded bg-white/60" />
              </div>
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-accent-500/30" />
                  <div className="flex-1 h-1.5 rounded bg-foreground/10" />
                </div>
              ))}
            </>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  )
}

// Loose decorative shapes for section backgrounds.
export function Gear({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
export function Coin({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 7v10M9.5 9.5a2.5 2 0 012.5-1.5c1.4 0 2.5.7 2.5 1.7M14.5 14.5a2.5 2 0 01-2.5 1.5c-1.4 0-2.5-.7-2.5-1.7" />
    </svg>
  )
}
export function TrendUp({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8m0 0h-5m5 0v5" />
    </svg>
  )
}
export function Dots({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 60 60" fill="currentColor">
      {Array.from({ length: 5 }).flatMap((_, r) =>
        Array.from({ length: 5 }).map((_, c) => <circle key={`${r}-${c}`} cx={6 + c * 12} cy={6 + r * 12} r={1.6} />)
      )}
    </svg>
  )
}
// A small SVG check for lists (replaces emoji ✓).
export function CheckMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  )
}
