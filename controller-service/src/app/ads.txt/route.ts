import { adsTxt } from '@/lib/analytics/adsense'

// Authorises the platform AdSense account on every store host, custom domains included.
export function GET() {
  return new Response(adsTxt(), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  })
}
