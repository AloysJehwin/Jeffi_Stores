import PortalShell from '@/components/portal/PortalShell'
import PortalSignOutButton from '@/components/portal/PortalSignOutButton'
import { CERT_PORTAL } from '@/lib/portal-config'
import CertList from './CertList'

export const dynamic = 'force-dynamic'

// Signed-in cert list + one-time download + install help. Middleware gates this path on the portal
// cookie, so an unauthenticated visitor is redirected to / before reaching here.
export default function CertsPage() {
  return (
    <PortalShell
      navTitle={CERT_PORTAL.navTitle}
      homeHref={CERT_PORTAL.successHref}
      navRight={<PortalSignOutButton endpoint={CERT_PORTAL.auth.logout} homeHref={CERT_PORTAL.homeHref} />}
    >
      <h1 className="text-2xl font-bold text-foreground">Your certificates</h1>
      <p className="mt-2 text-sm text-foreground-secondary">
        Download your admin certificate, then install it in your browser or system keychain. Each
        certificate can be downloaded once - save it and its password somewhere safe.
      </p>
      <CertList />
    </PortalShell>
  )
}
