import { LoadingLines, Sk } from '@/components/admin/kit/skeleton'
import { LoadingCard } from '../../products/_components/loading-parts'

const card = 'rounded-xl border border-border-default bg-surface-elevated'
const h3 = 'mb-3 text-sm font-semibold uppercase tracking-widest text-foreground-muted'
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-foreground-muted'

function Collapsed({ title }: { title: string }) {
  return (
    <div className={`px-5 py-3 ${card}`}>
      <span className="text-sm font-semibold text-foreground">{title}</span>
    </div>
  )
}

function EmailPreview({ title }: { title: string }) {
  return (
    <div className={`p-5 ${card}`}>
      <h3 className={h3}>{title}</h3>
      <div className="overflow-hidden rounded-lg border border-border-default">
        <div className="flex items-center gap-1 border-b border-border-default bg-surface-secondary px-4 py-2 text-xs">
          <span className="text-foreground-muted">Subject:</span>
          <Sk className="h-3 w-48" />
        </div>
        <Sk className="h-[520px] rounded-none" />
      </div>
    </div>
  )
}

/** The campaign view page body (summary, performance, panels beside the email preview). */
export function CampaignViewLoading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="space-y-5">
          <div className={`p-5 ${card}`}>
            <Sk className="h-6 w-48" />
            <Sk className="mt-2 h-4 w-64 max-w-full" />
            <div className="mt-4">
              {['Delay', 'Discount', 'Email template', 'Body mode', 'Last run'].map(l => (
                <div key={l} className="flex items-center justify-between gap-4 border-b border-border-default py-2 last:border-0">
                  <span className="text-xs font-medium text-foreground-muted">{l}</span>
                  <Sk className="h-3.5 w-24" />
                </div>
              ))}
            </div>
          </div>
          <div className={`p-5 ${card}`}>
            <h3 className={h3}>Performance</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {['Sent', 'Opened', 'Clicked', 'Converted', 'Revenue', 'Unsub'].map(l => (
                <div key={l}>
                  <p className="text-[10px] uppercase tracking-wide text-foreground-muted">{l}</p>
                  <Sk className="mt-1 h-6 w-12" />
                </div>
              ))}
            </div>
          </div>
          <Collapsed title="Eligible recipients" />
          <Collapsed title="Recent sends" />
        </div>
        <div className="space-y-5">
          <EmailPreview title="Email" />
        </div>
      </div>
      <LoadingCard title="Change log" hint="Who changed what, and when">
        <LoadingLines lines={3} />
      </LoadingCard>
    </div>
  )
}

/** The campaign editor body (AI rewrite, settings beside the preview, scenario, send test). */
export function CampaignEditLoading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className={`space-y-3 p-5 ${card}`}>
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Regenerate template with AI</p>
        <div className="flex gap-2">
          <Sk className="h-control flex-1 rounded-lg" />
          <Sk className="h-control w-24 rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className={`p-5 ${card}`}>
          <Sk className="h-6 w-48" />
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            {['Delay (hours)', 'Discount %', 'Assign coupon', 'Email template'].map(l => (
              <div key={l}>
                <p className={label}>{l}</p>
                <Sk className="h-control rounded-lg" />
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-4">
            {['Subject line', 'Email body'].map(l => (
              <div key={l}>
                <p className={label}>{l}</p>
                <Sk className={`rounded-lg ${l === 'Email body' ? 'h-40' : 'h-control'}`} />
              </div>
            ))}
          </div>
        </div>
        <EmailPreview title="Preview" />
      </div>
      <div className={`p-5 ${card}`}>
        <h3 className={h3}>Scenario &amp; parameters</h3>
        <p className={label}>Scenario (trigger)</p>
        <Sk className="h-control rounded-lg" />
      </div>
      <div className={`p-5 ${card}`}>
        <h3 className={h3}>Send test</h3>
        <div className="flex gap-2">
          <Sk className="h-control flex-1 rounded-lg" />
          <Sk className="h-control w-24 rounded-lg" />
        </div>
      </div>
    </div>
  )
}

/** The new-campaign form (AI generate, fields beside the preview). */
export function NewCampaignLoading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className={`space-y-3 p-5 ${card}`}>
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Generate template with AI</p>
        <div className="flex gap-2">
          <Sk className="h-control flex-1 rounded-lg" />
          <Sk className="h-control w-24 rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className={`space-y-4 p-5 ${card}`}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {['Campaign name', 'Kind (slug)'].map(l => (
              <div key={l}>
                <p className={label}>{l}</p>
                <Sk className="h-control rounded-lg" />
              </div>
            ))}
          </div>
          {['Description (optional)', 'Scenario (trigger)'].map(l => (
            <div key={l}>
              <p className={label}>{l}</p>
              <Sk className="h-control rounded-lg" />
            </div>
          ))}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {['Delay (hours)', 'Discount %'].map(l => (
              <div key={l}>
                <p className={label}>{l}</p>
                <Sk className="h-control rounded-lg" />
              </div>
            ))}
          </div>
          {['Assign coupon', 'Subject line', 'Email body'].map(l => (
            <div key={l}>
              <p className={label}>{l}</p>
              <Sk className={`rounded-lg ${l === 'Email body' ? 'h-40' : 'h-control'}`} />
            </div>
          ))}
        </div>
        <EmailPreview title="Preview" />
      </div>
    </div>
  )
}

/** Back link while its label (the campaign) is loading. */
export function BackLoading() {
  return <Sk className="h-3.5 w-28" />
}
