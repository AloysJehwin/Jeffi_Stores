import { cookies } from 'next/headers'
import { verifyStaffToken, STAFF_COOKIE } from '@/lib/staff-session'
import { resolveTenantId } from '@/lib/tenant-context'
import PortalShell from '@/components/portal/PortalShell'
import PortalSignIn from '@/components/portal/PortalSignIn'
import PortalSignOutButton from '@/components/portal/PortalSignOutButton'
import { STAFF_NOTES } from '@/lib/portal-config'
import StaffNotesEntry from '../StaffNotesEntry'

export const dynamic = 'force-dynamic'

export default async function StaffNotesPage() {
  const tenantId = await resolveTenantId()
  const session = await verifyStaffToken((await cookies()).get(STAFF_COOKIE)?.value)
  const valid = !!session && (session.tenantId ?? null) === (tenantId ?? null)

  if (!valid) {
    return (
      <PortalShell navTitle={STAFF_NOTES.navTitle} homeHref={STAFF_NOTES.homeHref} brand={STAFF_NOTES.brand} contentWidth="max-w-sm">
        <PortalSignIn config={STAFF_NOTES} />
      </PortalShell>
    )
  }
  return (
    <PortalShell
      navTitle={STAFF_NOTES.navTitle}
      homeHref={STAFF_NOTES.homeHref}
      navRight={<PortalSignOutButton endpoint={STAFF_NOTES.auth.logout} homeHref={STAFF_NOTES.homeHref} />}
      contentWidth="max-w-6xl"
    >
      <StaffNotesEntry staff={{ email: session!.email, name: session!.name }} />
    </PortalShell>
  )
}
