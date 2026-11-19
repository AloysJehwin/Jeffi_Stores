import '../styles/globals.css'
import ConditionalLayout from '@/components/ConditionalLayout'
import SessionGuard from '@/components/security/SessionGuard'
import Script from 'next/script'
import { getHost } from '@/lib/tenancy/get-host'
import { getStoreIdentity, getSiteControls, getStorefrontContent } from '@/lib/catalog/site-controls'
import { cssVarsRule, googleFontsHref, themeCssVars } from '@jeffi/site-blocks'
import { getPublishedTheme, getSiteDraft } from '@/lib/site/store'
import { verifyHomepagePreviewToken } from '@/lib/catalog/homepage-preview-token'
import { normalizeTheme } from '@jeffi/site-blocks'
import { headers } from 'next/headers'
import { getSiteChrome } from '@/lib/site/chrome'
import { getWebSurface } from '@/lib/catalog/web-surface'
import { loadCodeChrome } from '@/components/visitor/site/code/parts/chrome/code-chrome'
import { storefrontAiAllowed } from '@/lib/shared/storefront-ai'
import { appFromHost } from '@/lib/tenant-registry'
import type { StoreConfig } from '@/contexts/StoreConfigContext'
import { resolveGoogleTag, gtagBootstrapScript } from '@/lib/analytics/google-tag'
import { adsenseClient, adsenseInitScript, adsenseScriptSrc } from '@/lib/analytics/adsense'
import AdSense from '@/components/visitor/AdSense'
import { storeIsAdFree } from '@/lib/billing/ad-free'
import { schemes } from '@jeffi/design-tokens'

export async function generateMetadata() {
  const identity = await getStoreIdentity()
  const content = await getStorefrontContent()

  // Tagline and description described the flagship's trade ("Industrial Hardware & Tools"),
  // so every tenant store — whatever it sells — inherited a hardware shop's title and meta
  // description. Both come from the store's own storefront content, with the identity name as
  // the only guaranteed part.
  const tagline = content.metaTagline?.trim()
  const description = content.metaDescription?.trim()

  // The store's favicon (else its logo) is the tab icon; /icon.png is the platform's.
  // favicon.ico lives in public/ (not app/) so Next doesn't inject it ahead of the tenant's icon.
  const logo = identity.faviconUrl?.trim() || identity.logoUrl?.trim()
  const icon = logo || [{ url: '/favicon.ico', sizes: '32x32' }, { url: '/icon.png' }]

  return {
    title: tagline ? `${identity.name} - ${tagline}` : identity.name,
    description: description || `Shop online at ${identity.name}.`,
    icons: {
      icon,
      apple: logo || '/apple-icon.png',
    },
    appleWebApp: { capable: true, title: identity.name, statusBarStyle: 'default' as const },
  }
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // The browser chrome matches the header surface in each scheme.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: schemes.light.surfaceElevated },
    { media: '(prefers-color-scheme: dark)', color: schemes.dark.surfaceElevated },
  ],
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
  const tenant = await resolveTenant().catch(() => null)
  const storeSlug = tenant?.slug ?? null
  // Each store loads its own tag; tenants without one load nothing (never the flagship's).
  const googleTag = isVaultSubdomain
    ? null
    : resolveGoogleTag({
        tagId: c.marketing.googleTagId,
        conversionId: c.marketing.googleAdsConversionId,
        conversionLabel: c.marketing.googleAdsConversionLabel,
        isTenant: storeSlug != null,
      })
  const hasGoogleTag = !!googleTag && googleTag.tagIds.length > 0
  // Consent Mode + banner on the storefront host only; staff/marketing hosts keep plain measurement.
  const isStorefrontHost =
    !isFormsSubdomain &&
    !isDocumentSubdomain &&
    !isBusinessSubdomain &&
    !isAdminSubdomain &&
    !isEcomSubdomain &&
    !isCertPortalSubdomain &&
    !isVaultSubdomain
  // Platform AdSense on every store unless its tenant paid to remove ads (lib/billing/ad-free.ts).
  const adClient = isStorefrontHost ? adsenseClient() : null
  const showAds = !!adClient && !(await storeIsAdFree(tenant?.tenantId))
  const cookieConsent = (hasGoogleTag || showAds) && isStorefrontHost
  // A Site Builder theme recolours and re-fonts the store and business pages (never the staff hosts). Set on the body,
  // twice-classed, so it wins over the base :root / .dark variables.
  // In the Site Builder canvas (a preview token): the draft's theme when it has one, and its header, footer and
  // announcement bar on the layout the canvas asks for.
  const sitePreview =
    isStorefrontHost || isBusinessSubdomain
      ? await verifyHomepagePreviewToken((await headers()).get('x-site-preview'))
          .then(t => (t?.kind === 'site' ? t : null))
          .catch(() => null)
      : null
  const previewTheme = sitePreview
    ? await getSiteDraft(sitePreview.draftId)
        .then(d => {
          const tokens = d?.docs.theme?.[isBusinessSubdomain ? 'business' : 'store']
          return tokens ? normalizeTheme(tokens) : null
        })
        .catch(() => null)
    : null
  const chromeSurface = async () => {
    const s = await getWebSurface(sitePreview ? (await headers()).get('x-site-layout') : null, !!sitePreview)
    return s === 'web_mobile' ? 'web_mobile' : 'web'
  }
  const siteTheme =
    previewTheme ??
    (isStorefrontHost || isBusinessSubdomain
      ? ((isBusinessSubdomain ? await getPublishedTheme('business').catch(() => null) : null) ??
        (await getPublishedTheme('store').catch(() => null)))
      : null)
  // The header, footer and announcement bar from Site Builder (phones get their own layout).
  const siteChrome =
    isStorefrontHost || isBusinessSubdomain
      ? await chromeSurface()
          .then(s => getSiteChrome(isBusinessSubdomain ? 'business' : 'store', s, sitePreview?.draftId))
          .catch(() => null)
      : null
  // The AI-written header, footer and announcement bar (AI Site Studio) replace the built-in ones on the storefront.
  const codeChrome = isStorefrontHost
    ? await chromeSurface()
        .then(s => loadCodeChrome('store', s, sitePreview))
        .catch(() => null)
    : null
  // The AI-written product card's styles, once, in <head>. A card's own copy can land in a tree the browser never
  // shows (the 404 page every route carries), which would leave every shown card without them. Loaded only on demand.
  const siteCardStyles = isStorefrontHost
    ? await Promise.all([import('@/lib/site/card'), import('@/components/visitor/site/code/common/SiteCard')])
        .then(async ([{ siteCard }, { SiteCardStyles }]) => {
          const card = await siteCard()
          return card ? <SiteCardStyles card={card} always /> : null
        })
        .catch(() => null)
    : null
  const siteThemeCss = siteTheme
    ? `${cssVarsRule('body.site-theme.site-theme', themeCssVars(siteTheme))}body.site-theme{font-family:var(--font-body),system-ui,sans-serif}`
    : null
  const consentBootstrap = hasGoogleTag ? googleTag! : showAds ? { tagIds: [], conversionSendTo: null } : null
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
      upiEnabled: c.flags.upiEnabled,
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
    chrome: siteChrome,
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
        {/* Consent defaults must reach dataLayer before gtag.js loads, so this runs inline in <head>. */}
        {consentBootstrap && (
          <script
            id="gtag-init"
            dangerouslySetInnerHTML={{ __html: gtagBootstrapScript(consentBootstrap, cookieConsent) }}
          />
        )}
        {showAds && <meta name="google-adsense-account" content={adClient!} />}
        {showAds && <script id="adsense-init" dangerouslySetInnerHTML={{ __html: adsenseInitScript() }} />}
        {siteTheme && <link rel="stylesheet" href={googleFontsHref(siteTheme)} />}
        {siteThemeCss && <style id="site-theme" dangerouslySetInnerHTML={{ __html: siteThemeCss }} />}
        {siteCardStyles}
      </head>
      <body
        className={`antialiased m-0 p-0 ${isVaultSubdomain ? 'bg-neutral-950 text-neutral-100' : 'bg-surface text-foreground'}${siteTheme ? ' site-theme' : ''}`}
      >
        <SessionGuard />
        {/* No third-party analytics on the vault (strict CSP, buyer privacy). */}
        {hasGoogleTag && (
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(googleTag!.tagIds[0])}`}
            strategy="afterInteractive"
          />
        )}
        {/* After hydration: loaded from <head> it inserts its own script there first, React's head no longer
            matches the server's, and every page was thrown away and redrawn blank on the client. The
            google-adsense-account meta tag above is what site verification reads. */}
        {showAds && (
          <Script
            id="adsbygoogle"
            src={adsenseScriptSrc(adClient!)}
            strategy="afterInteractive"
            crossOrigin="anonymous"
          />
        )}
        {showAds && <AdSense />}
        <ConditionalLayout
          initialStoreConfig={initialStoreConfig}
          isFormsSubdomain={isFormsSubdomain}
          isDocumentSubdomain={isDocumentSubdomain}
          isBusinessSubdomain={isBusinessSubdomain}
          isAdminSubdomain={isAdminSubdomain}
          isEcomSubdomain={isEcomSubdomain}
          isCertPortalSubdomain={isCertPortalSubdomain}
          isVaultSubdomain={isVaultSubdomain}
          cookieConsent={cookieConsent}
          codeChrome={codeChrome}
        >
          {children}
        </ConditionalLayout>
      </body>
    </html>
  )
}
