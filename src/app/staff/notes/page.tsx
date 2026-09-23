import { cookies } from 'next/headers'
import { verifyStaffToken, STAFF_COOKIE } from '@/lib/staff-session'
import { resolveTenantId } from '@/lib/tenant-context'
import { getStoreIdentity } from '@/lib/site-controls'
import StaffSignIn from '../StaffSignIn'
import StaffNotesForm from '../StaffNotesForm'

export const dynamic = 'force-dynamic'

export default async function StaffNotesPage() {
  const { name } = await getStoreIdentity()
  const tenantId = await resolveTenantId()
  const session = await verifyStaffToken((await cookies()).get(STAFF_COOKIE)?.value)
  const valid = !!session && (session.tenantId ?? null) === (tenantId ?? null)
  if (!valid) return <StaffSignIn storeName={name} />
  return <StaffNotesForm storeName={name} staff={{ email: session!.email, name: session!.name }} />
}
