import { LoadingChart, LoadingKpis, LoadingSection, LoadingTable, Sk } from '@/components/admin/kit/skeleton'
import { PERIOD_PRESETS } from '@/lib/overview/period'
import { SplitRow } from '@/components/admin/kit'

/** The overview's period bar (30 days by default) while it loads. */
export function PeriodBarLoading() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex h-control max-w-full gap-0.5 overflow-hidden rounded-lg border border-border-default bg-surface-elevated p-0.5">
        {PERIOD_PRESETS.map(p => (
          <span key={p.id} className={`flex items-center whitespace-nowrap rounded-md px-2.5 text-xs font-medium ${p.id === '30d' ? 'bg-accent-500 text-white' : 'text-foreground-muted'}`}>
            {p.label}
          </span>
        ))}
      </div>
      <Sk className="h-control w-32 rounded-lg" />
      <Sk className="h-control w-32 rounded-lg" />
    </div>
  )
}

function Heading({ title }: { title: string }) {
  return <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">{title}</h2>
}

/** The Overview tab's body while its data loads. */
export function ProgramsOverviewLoading() {
  return (
    <>
      <Heading title="Loyalty" />
      <LoadingKpis labels={['Points issued', 'Points redeemed', 'Points reversed', 'Liability', 'Active members', 'New members']} />
      <SplitRow
        wide={
          <LoadingChart title="Points issued and redeemed" />
        }
        narrow={
          <LoadingSection title="Members by tier">
            <Sk className="mx-auto h-36 w-36 rounded-full" />
          </LoadingSection>
        }
      />
      <LoadingSection title="Top earners this period">
        <LoadingTable columns={['Customer', 'Tier', 'Earned', 'Redeemed', 'Balance']} rows={5} bare />
      </LoadingSection>
      <div className="pt-2">
        <Heading title="Refer & Earn" />
      </div>
      <LoadingKpis labels={['Invites sent', 'Signups', 'First orders', 'Referred revenue', 'Rewarded', 'All-time signups']} />
      <LoadingSection title="Top referrers this period">
        <LoadingTable columns={['Referrer', 'Signups', 'Rewarded', 'Referred revenue']} rows={5} bare />
      </LoadingSection>
    </>
  )
}
