import { headers } from 'next/headers'
import { hasScope, isPlatformAdmin } from '@/lib/auth/scopes'
import { ErrorState, PageBody } from '@/components/admin/kit'
import { getSetupGuide } from '@/lib/setup-guide/status'
import { setupTenantId } from '@/lib/setup-guide/route'
import SetupGuideClient from './_components/SetupGuideClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function SetupGuidePage() {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  let scopes: string[] = []
  try {
    scopes = JSON.parse(h.get('x-user-scopes') || '[]')
  } catch {}
  try {
    const tenantId = await setupTenantId()
    const guide = await getSetupGuide({ role, scopes }, tenantId)
    return (
      <SetupGuideClient
        initial={{ ...guide, canWrite: hasScope(role, scopes, 'setup_guide:write'), platform: !tenantId && isPlatformAdmin(role) }}
      />
    )
  } catch (e) {
    console.error('[setup-guide] page failed', e)
    return (
      <PageBody>
        <ErrorState title="Could not load the setup guide" body="Try again in a moment." />
      </PageBody>
    )
  }
}
