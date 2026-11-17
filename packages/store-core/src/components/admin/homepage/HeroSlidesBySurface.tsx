'use client'

import type { ComponentProps } from 'react'
import HeroSlideManager from '@/components/admin/HeroSlideManager'
import { rowSurface, type HomepageSurface } from '@/lib/catalog/homepage-sections'

const NAME: Record<HomepageSurface, string> = { web: 'Desktop web', web_mobile: 'Mobile web', app: 'App' }

// The Hero section's slides on the device being edited: every device has a set of its own.
export default function HeroSlidesBySurface(props: ComponentProps<typeof HeroSlideManager>) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground-muted">
        These slides show on {NAME[props.surface ?? 'web']} only. Each device has its own set.
      </p>
      <HeroSlideManager {...props} initialSlides={props.initialSlides.filter(r => rowSurface(r) === (props.surface ?? 'web'))} />
    </div>
  )
}
