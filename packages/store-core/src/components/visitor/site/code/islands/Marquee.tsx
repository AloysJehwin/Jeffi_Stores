import { Children, type ReactNode } from 'react'

// A scrolling strip, pure CSS (no client JS): the items twice, translated by half. Pauses on hover; still for
// reduced motion.

const SPEED: Record<string, string> = { slow: '45s', normal: '28s', fast: '15s' }
const CSS = `@keyframes cs-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}.cs-marquee-track{animation:cs-marquee linear infinite}.cs-marquee[data-reverse] .cs-marquee-track{animation-direction:reverse}.cs-marquee[data-pause]:hover .cs-marquee-track{animation-play-state:paused}@media (prefers-reduced-motion:reduce){.cs-marquee-track{animation:none}}`

export default function Marquee({ speed = 'normal', direction = 'left', pauseOnHover = true, className, children }: { speed?: string; direction?: 'left' | 'right'; pauseOnHover?: boolean; className?: string; children?: ReactNode }) {
  const items = Children.toArray(children)
  if (!items.length) return null
  return (
    <div className={`cs-marquee overflow-hidden ${className ?? ''}`} {...(direction === 'right' ? { 'data-reverse': '' } : {})} {...(pauseOnHover ? { 'data-pause': '' } : {})}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="cs-marquee-track flex w-max items-center gap-10 whitespace-nowrap" style={{ animationDuration: SPEED[speed] ?? SPEED.normal }}>
        {items}
        <div aria-hidden className="flex items-center gap-10">
          {items}
        </div>
      </div>
    </div>
  )
}
