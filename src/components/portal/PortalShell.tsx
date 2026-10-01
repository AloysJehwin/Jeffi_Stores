import { headers } from 'next/headers'
import { PortalDeviceProvider } from '@/contexts/PortalDeviceContext'
import PortalTopNav from './PortalTopNav'
import PortalBrandPanel, { type BrandPanelProps } from './PortalBrandPanel'

export function isMobileUserAgent(ua: string): boolean {
  return /android|iphone|ipad|ipod|mobile|blackberry|iemobile|opera mini/i.test(ua)
}

interface Props {
  children: React.ReactNode
  navTitle?: string
  homeHref?: string
  navRight?: React.ReactNode
  /** When set, desktop renders the split screen (brand panel + content); mobile shows a compact intro instead. */
  brand?: BrandPanelProps & { mobileIntro?: string }
  contentWidth?: string
  /** Sign-in pages have nothing to navigate to yet, so they drop the top bar. */
  hideNav?: boolean
}

// One shell for every portal surface. Detects the device server-side and renders a DEDICATED
// mobile or desktop tree: desktop uses the full viewport (split screen when a brand panel is
// given, otherwise a wide centred column); mobile is a single full-width column with room for a
// sticky bottom action bar.
export default async function PortalShell({
  children,
  navTitle,
  homeHref,
  navRight,
  brand,
  contentWidth = 'max-w-2xl',
  hideNav = false,
}: Props) {
  const ua = (await headers()).get('user-agent') || ''
  const isMobile = isMobileUserAgent(ua)

  return (
    <PortalDeviceProvider isMobile={isMobile}>
      <div className="min-h-screen flex flex-col bg-surface text-foreground">
        {!hideNav && (
          <PortalTopNav
            title={navTitle}
            homeHref={homeHref}
            right={navRight}
            maxWidth={isMobile ? 'max-w-full' : 'max-w-6xl'}
          />
        )}
        {isMobile ? (
          <main className="flex-1 w-full px-4 pt-5 pb-28">
            {brand?.mobileIntro && <p className="text-xs text-foreground-muted mb-4">{brand.mobileIntro}</p>}
            {children}
          </main>
        ) : brand ? (
          <div className="flex-1 grid lg:grid-cols-2">
            <PortalBrandPanel
              badge={brand.badge}
              heading={brand.heading}
              points={brand.points}
              footnote={brand.footnote}
            />
            <main className="flex flex-col justify-center px-8 xl:px-16 py-12">
              <div className={`w-full mx-auto ${contentWidth}`}>{children}</div>
            </main>
          </div>
        ) : (
          <main className="flex-1 w-full px-8 py-10">
            <div className={`mx-auto w-full ${contentWidth}`}>{children}</div>
          </main>
        )}
      </div>
    </PortalDeviceProvider>
  )
}
