import './globals.css'
import ConditionalLayout from '@/components/ConditionalLayout'
import Script from 'next/script'
import { getHost } from '@/lib/get-host'
import { getStoreIdentity, getSiteControls } from '@/lib/site-controls'
import type { StoreConfig } from '@/contexts/StoreConfigContext'

export async function generateMetadata() {
  const identity = await getStoreIdentity()
  return {
    title: `${identity.name} - Industrial Hardware & Tools`,
    description: `Your trusted hardware partner for industrial machinery parts, tools, and equipment`,
    icons: {
      icon: '/icon.png',
      apple: '/apple-icon.png',
    },
  }
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const host = await getHost()
  const isFormsSubdomain = host.startsWith('forms.')
  const isDocumentSubdomain = host.startsWith('invoice.') || host.startsWith('quotation.') || host.startsWith('purchaseorder.')
  const isBusinessSubdomain = host.startsWith('business.')
  const isAdminSubdomain = host.startsWith('admin.')

  // Read the browser-safe store config on the server so the very first render
  // (SSR + hydration) already has the true DB-backed values — no client fetch
  // flash on price/GST. Mirrors the /api/store-config payload shape.
  const c = await getSiteControls()
  const initialStoreConfig: StoreConfig = {
    identity: {
      name: c.identity.name,
      email: c.identity.email,
      phone: c.identity.phone,
      web: c.identity.web,
      logoUrl: c.identity.logoUrl,
    },
    flags: {
      razorpayEnabled: c.flags.razorpayEnabled,
      gstEnabled: c.flags.gstEnabled,
      ondeviceSummaryEnabled: c.flags.ondeviceSummaryEnabled,
      ondeviceFinetuneEnabled: c.flags.ondeviceFinetuneEnabled,
      ondeviceSummaryMobileEnabled: c.flags.ondeviceSummaryMobileEnabled,
      ondeviceSummaryDesktopEnabled: c.flags.ondeviceSummaryDesktopEnabled,
      ondeviceFinetuneMobileEnabled: c.flags.ondeviceFinetuneMobileEnabled,
      ondeviceFinetuneDesktopEnabled: c.flags.ondeviceFinetuneDesktopEnabled,
    },
    orderAutoCancelMinutes: c.values.orderAutoCancelMinutes,
    storefront: {
      featuredLimit: c.storefront.featuredLimit,
      newArrivalsLimit: c.storefront.newArrivalsLimit,
    },
  }
  return (
    <html lang="en" className="bg-surface" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=sessionStorage.getItem('jeffi-theme')||localStorage.getItem('jeffi-theme')||sessionStorage.getItem('jeffi-admin-theme')||localStorage.getItem('jeffi-admin-theme');if(t==='dark'){document.documentElement.classList.add('dark')}else if(t==='light'){document.documentElement.classList.remove('dark')}}catch(e){}})()` }}
        />
      </head>
      <body className="antialiased bg-surface text-foreground m-0 p-0">
        <Script src="https://www.googletagmanager.com/gtag/js?id=GT-NM2C3M85" strategy="afterInteractive" />
        <Script id="gtag-init" strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','GT-NM2C3M85');` }}
        />
        <ConditionalLayout initialStoreConfig={initialStoreConfig} isFormsSubdomain={isFormsSubdomain} isDocumentSubdomain={isDocumentSubdomain} isBusinessSubdomain={isBusinessSubdomain} isAdminSubdomain={isAdminSubdomain}>{children}</ConditionalLayout>
      </body>
    </html>
  )
}
