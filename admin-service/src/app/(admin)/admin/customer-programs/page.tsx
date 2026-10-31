import { Suspense } from 'react'
import { TabLinks } from '@/components/admin/channels/ui'
import { cookies } from 'next/headers'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { verifyToken } from '@/lib/auth/jwt'
import { hasPlanScope } from '@/lib/auth/plan-gate'
import { adminCookieName } from '@/lib/auth/admin-cookie'
import AccessDenied from '@/components/admin/AccessDenied'
import LoyaltyProgram from './_components/LoyaltyProgram'
import ReferralProgram from './_components/ReferralProgram'
import BirthdayProgram from './_components/BirthdayProgram'
import ProgramsOverview from './_components/ProgramsOverview'
import { PROGRAMS_PATH } from './_components/ProgramSection'
import { PageBody, PageHeader } from '@/components/admin/kit'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Each program is switched on or off in Site Controls; one that is off still shows here, greyed out.
// New programs get a tab here.
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'loyalty', label: 'Loyalty' },
  { key: 'referrals', label: 'Refer & Earn' },
  { key: 'birthday', label: 'Birthday rewards' },
] as const
type TabKey = (typeof TABS)[number]['key']

function pageNumber(value: string | undefined): number {
  return Math.max(1, parseInt(value || '1', 10) || 1)
}

export default async function CustomerProgramsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const params = await searchParams
  const host = await getHost()

  // Customer reward programs ship on the campaigns scope (Pro+). Block direct-URL access on plans
  // that don't include it — the nav link is already hidden, this is the server-side backstop.
  const cookieStore = await cookies()
  const token = cookieStore.get(await adminCookieName())
  let role = ''
  let scopes: string[] = []
  try {
    if (token) {
      const payload = await verifyToken(token.value)
      role = payload?.role || ''
      scopes = payload?.scopes || []
    }
  } catch {}
  if (!(await hasPlanScope(role, scopes, 'campaigns:read'))) {
    return <AccessDenied scopeKey="campaigns" scopeLabel="Programs" />
  }

  // Overview is the default; an old link carrying loyalty list params (page, tier, search) still opens Loyalty.
  const tab: TabKey =
    TABS.find(t => t.key === params.tab)?.key ?? (params.page || params.tier || params.search ? 'loyalty' : 'overview')
  const basePath = ap(PROGRAMS_PATH, host)
  const search = params.search || ''
  const page = pageNumber(params.page)

  return (
    <PageBody>
      <PageHeader
        title="Programs"
        description="Rewards that keep customers coming back. Switch each one on or off in Site Controls."
      />

      <TabLinks
        tabs={TABS.map(t => ({
          id: t.key,
          label: t.label,
          href: t.key === 'overview' ? basePath : `${basePath}?tab=${t.key}`,
        }))}
        value={tab}
      />

      {tab === 'overview' && (
        <Suspense fallback={null}>
          <ProgramsOverview />
        </Suspense>
      )}
      {tab === 'loyalty' && <LoyaltyProgram host={host} query={{ page, tier: params.tier || '', search, sort: params.sort, dir: params.dir }} />}
      {tab === 'referrals' && <ReferralProgram host={host} query={{ page, status: params.status || '', search, sort: params.sort, dir: params.dir }} />}
      {tab === 'birthday' && <BirthdayProgram host={host} />}
    </PageBody>
  )
}
