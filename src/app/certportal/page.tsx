import PortalShell from '@/components/portal/PortalShell'
import PortalSignIn from '@/components/portal/PortalSignIn'
import { CERT_PORTAL } from '@/lib/portal-config'

export const dynamic = 'force-dynamic'

// certificate.jeffistores.in sign-in: Google or one-time email code. Desktop is the split screen
// (brand panel + form); mobile is a single full-width column. /certs is gated by middleware.
export default function CertPortalPage() {
  return (
    <PortalShell navTitle={CERT_PORTAL.navTitle} homeHref={CERT_PORTAL.homeHref} brand={CERT_PORTAL.brand} contentWidth="max-w-sm" hideNav>
      <PortalSignIn config={CERT_PORTAL} />
    </PortalShell>
  )
}
