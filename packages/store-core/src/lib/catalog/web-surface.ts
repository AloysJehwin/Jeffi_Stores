import { headers } from 'next/headers'
import { parseUserAgent } from '@/lib/traffic/user-agent'
import type { HomepageSurface } from '@/lib/catalog/homepage-sections'

/** Phones get the mobile web layout; tablets, desktops and crawlers the desktop one. `?layout=` overrides it. */
export function surfaceForUA(ua: string | null | undefined, layout?: string | null, preview = false): HomepageSurface {
  if (layout === 'mobile') return 'web_mobile'
  if (layout === 'desktop') return 'web'
  // The app's sections drawn by the web renderer: an approximation the admin preview asks for.
  if (layout === 'app' && preview) return 'app'
  return parseUserAgent(ua).device === 'Mobile' ? 'web_mobile' : 'web'
}

/** The layout this request's browser sees. `layout` is the page's `?layout=mobile|desktop` (`app` with a preview token). */
export async function getWebSurface(layout?: string | null, preview = false): Promise<HomepageSurface> {
  return surfaceForUA((await headers()).get('user-agent'), layout, preview)
}
