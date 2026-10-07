import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import LoyaltyProgram from './_components/LoyaltyProgram'
import ReferralProgram from './_components/ReferralProgram'
import BirthdayProgram from './_components/BirthdayProgram'
import { PROGRAMS_PATH } from './_components/ProgramSection'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Each program is switched on or off in Site Controls; one that is off still shows here, greyed out.
// New programs get a tab here.
const TABS = [
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
  const tab: TabKey = TABS.find(t => t.key === params.tab)?.key ?? 'loyalty'
  const basePath = ap(PROGRAMS_PATH, host)
  const search = params.search || ''
  const page = pageNumber(params.page)

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Customer Programs</h1>
        <p className="text-foreground-secondary mt-1 text-sm">
          Rewards that keep customers coming back. Switch each one on or off in Site Controls.
        </p>
      </div>

      <div className="flex gap-1 border-b border-border overflow-x-auto" role="tablist">
        {TABS.map(t => (
          <Link
            key={t.key}
            href={t.key === 'loyalty' ? basePath : `${basePath}?tab=${t.key}`}
            role="tab"
            aria-selected={tab === t.key}
            className={`shrink-0 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-foreground text-foreground'
                : 'border-transparent text-foreground-muted hover:text-foreground'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'loyalty' && <LoyaltyProgram host={host} query={{ page, tier: params.tier || '', search }} />}
      {tab === 'referrals' && <ReferralProgram host={host} query={{ page, status: params.status || '', search }} />}
      {tab === 'birthday' && <BirthdayProgram host={host} />}
    </div>
  )
}
