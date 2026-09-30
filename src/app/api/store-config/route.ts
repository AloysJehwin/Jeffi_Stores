import { NextResponse } from 'next/server'
import { getSiteControls } from '@/lib/catalog/site-controls'
import { storefrontAiAllowed } from '@/lib/shared/storefront-ai'

export const dynamic = 'force-dynamic'

// Public, browser-safe store config. Bridges DB-backed settings to client
// components that previously read NEXT_PUBLIC_* env vars at build time.
// Contains NO secrets — only display identity, feature toggles, storefront limits.
export async function GET() {
  const c = await getSiteControls()
  const aiStorefrontEnabled = await storefrontAiAllowed().catch(() => false)
  return NextResponse.json(
    {
      identity: {
        name: c.identity.name,
        email: c.identity.email,
        phone: c.identity.phone,
        web: c.identity.web,
        logoUrl: c.identity.logoUrl,
      },
      flags: {
        razorpayEnabled: c.flags.razorpayEnabled,
        codEnabled: c.flags.codEnabled,
        gstEnabled: c.flags.gstEnabled,
        ondeviceSummaryEnabled: c.flags.ondeviceSummaryEnabled,
        ondeviceFinetuneEnabled: c.flags.ondeviceFinetuneEnabled,
        ondeviceSummaryMobileEnabled: c.flags.ondeviceSummaryMobileEnabled,
        ondeviceSummaryDesktopEnabled: c.flags.ondeviceSummaryDesktopEnabled,
        ondeviceFinetuneMobileEnabled: c.flags.ondeviceFinetuneMobileEnabled,
        ondeviceFinetuneDesktopEnabled: c.flags.ondeviceFinetuneDesktopEnabled,
        aiStorefrontEnabled,
      },
      orderAutoCancelMinutes: c.values.orderAutoCancelMinutes,
      storefront: {
        featuredLimit: c.storefront.featuredLimit,
        newArrivalsLimit: c.storefront.newArrivalsLimit,
        metaTagline: c.storefront.metaTagline,
      },
    },
    // No browser/CDN caching: flag changes must reach clients within the
    // reader's own 30s server-side TTL, not compound with a browser cache
    // window. The payload is tiny and per-store, so this is cheap.
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
}
