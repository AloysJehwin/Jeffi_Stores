'use client'

import { useState, type ComponentProps } from 'react'
import HeroSlideManager from '@/components/admin/HeroSlideManager'
import { HOMEPAGE_SURFACES, rowSurface, type HomepageSurface } from '@/lib/catalog/homepage-sections'

const TAB: Record<HomepageSurface, string> = { web: 'Desktop web', web_mobile: 'Mobile web', app: 'App' }

// Hero slides keep a set per surface (phones and the app show the desktop set until they have their
// own), so the Hero section's editor tabs them. Every manager stays mounted: each seeds its state once.
export default function HeroSlidesBySurface(props: Omit<ComponentProps<typeof HeroSlideManager>, 'surface'>) {
  const [surface, setSurface] = useState<HomepageSurface>('web')
  const count = (s: HomepageSurface) => props.initialSlides.filter(r => rowSurface(r) === s).length
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="tablist" aria-label="Hero slides" className="flex h-control gap-0.5 p-0.5 bg-surface-elevated border border-border-default rounded-lg w-fit">
          {HOMEPAGE_SURFACES.map(s => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={s === surface}
              onClick={() => setSurface(s)}
              className={`flex items-center gap-1.5 px-3 text-xs font-medium rounded-md ${s === surface ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
            >
              {TAB[s]}
              {count(s) > 0 && <span className="tabular-nums opacity-80">{count(s)}</span>}
            </button>
          ))}
        </div>
        <p className="text-xs text-foreground-muted">
          {surface === 'web' ? 'Desktop and tablet browsers.' : `${TAB[surface]} shows the desktop slides until it has slides of its own.`}
        </p>
      </div>
      {HOMEPAGE_SURFACES.map(s => (
        <div key={s} className={s === surface ? '' : 'hidden'}>
          <HeroSlideManager {...props} surface={s} initialSlides={props.initialSlides.filter(r => rowSurface(r) === s)} />
        </div>
      ))}
    </div>
  )
}
