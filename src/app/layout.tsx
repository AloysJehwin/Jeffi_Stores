import './globals.css'
import ConditionalLayout from '@/components/ConditionalLayout'
import SessionGuard from '@/components/security/SessionGuard'
import Script from 'next/script'
import { getHost } from '@/lib/tenancy/get-host'
import { getStoreIdentity, getSiteControls, getStorefrontContent } from '@/lib/catalog/site-controls'
import { storefrontAiAllowed } from '@/lib/shared/storefront-ai'
import { appFromHost } from '@/lib/tenant-registry'
import type { StoreConfig } from '@/contexts/StoreConfigContext'

export async function generateMetadata() {
  const identity = await getStoreIdentity()
  const content = await getStorefrontContent()

  // Tagline and description described the flagship's trade ("Industrial Hardware & Tools"),
  // so every tenant store — whatever it sells — inherited a hardware shop's title and meta
  // description. Both come from the store's own storefront content, with the identity name as
  // the only guaranteed part.
  const tagline = content.metaTagline?.trim()
  const description = content.metaDescription?.trim()

  // A tenant that uploaded a logo should use it as the tab icon; /icon.png is the platform's.
  // favicon.ico lives in public/ (not app/) so Next doesn't inject it ahead of the tenant logo.
  const logo = identity.logoUrl?.trim()
  const icon = logo || [{ url: '/favicon.ico', sizes: '32x32' }, { url: '/icon.png' }]

  return {
    title: tagline ? `${identity.name} - ${tagline}` : identity.name,
    description: description || `Shop online at ${identity.name}.`,
    icons: {
      icon,
      apple: logo || '/apple-icon.png',
    },
  }
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const host = await getHost()
  const hostApp = appFromHost(host)
  const isFormsSubdomain = hostApp === 'forms'
  const isDocumentSubdomain = hostApp === 'invoice' || hostApp === 'quotation' || hostApp === 'purchaseorder'
  const isBusinessSubdomain = hostApp === 'business'
  const isAdminSubdomain = hostApp === 'admin'
  const isEcomSubdomain = host.startsWith('ecom.')
  const isCertPortalSubdomain = host.startsWith('certificate.')
  const isVaultSubdomain = hostApp === 'vault'

  // Read the browser-safe store config on the server so the very first render
  // (SSR + hydration) already has the true DB-backed values — no client fetch
  // flash on price/GST. Mirrors the /api/store-config payload shape.
  const c = await getSiteControls()
  const aiStorefrontEnabled = await storefrontAiAllowed().catch(() => false)
  const { resolveTenant } = await import('@/lib/tenancy/tenant-context')
  const storeSlug = (await resolveTenant().catch(() => null))?.slug ?? null
  const initialStoreConfig: StoreConfig = {
    slug: storeSlug,
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
      digitalProductsEnabled: c.flags.digitalProductsEnabled,
      subscriptionsEnabled: c.flags.subscriptionsEnabled,
      vaultDownloadsEnabled: c.flags.vaultDownloadsEnabled,
    },
    orderAutoCancelMinutes: c.values.orderAutoCancelMinutes,
    storefront: {
      featuredLimit: c.storefront.featuredLimit,
      newArrivalsLimit: c.storefront.newArrivalsLimit,
      metaTagline: c.storefront.metaTagline,
    },
  }
  return (
    // Vault: dark html/body so iOS/macOS overscroll bounce never reveals the light store surface.
    <html
      lang="en"
      className={isVaultSubdomain ? 'bg-neutral-950 [color-scheme:dark]' : 'bg-surface'}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var k='jeffi-theme';var t=sessionStorage.getItem(k)||localStorage.getItem(k);var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`antialiased m-0 p-0 ${isVaultSubdomain ? 'bg-neutral-950 text-neutral-100' : 'bg-surface text-foreground'}`}
      >
        <SessionGuard />
        {/* No third-party analytics on the vault (strict CSP, buyer privacy). */}
        {!isVaultSubdomain && (
          <>
            <Script src="https://www.googletagmanager.com/gtag/js?id=GT-NM2C3M85" strategy="afterInteractive" />
            <Script
              id="gtag-init"
              strategy="afterInteractive"
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','GT-NM2C3M85');`,
              }}
            />
          </>
        )}
        <ConditionalLayout
          initialStoreConfig={initialStoreConfig}
          isFormsSubdomain={isFormsSubdomain}
          isDocumentSubdomain={isDocumentSubdomain}
          isBusinessSubdomain={isBusinessSubdomain}
          isAdminSubdomain={isAdminSubdomain}
          isEcomSubdomain={isEcomSubdomain}
          isCertPortalSubdomain={isCertPortalSubdomain}
          isVaultSubdomain={isVaultSubdomain}
        >
          {children}
        </ConditionalLayout>
      </body>
    </html>
  )
}
