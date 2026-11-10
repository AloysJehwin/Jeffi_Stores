import { Sk } from '@/components/admin/kit/skeleton'

const card = 'rounded-xl border border-border-default bg-surface-elevated'
const caption = 'text-[10px] uppercase tracking-wide text-foreground-muted'

/** "Scenarios / …" breadcrumb; the current name shimmers unless given. */
export function ScenarioCrumbLoading({ current }: { current?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-foreground-muted">Scenarios</span>
      <span className="text-foreground-muted">/</span>
      {current ? <span className="font-medium text-foreground">{current}</span> : <Sk className="h-4 w-40" />}
    </div>
  )
}

export function ScenarioDetailLoading() {
  return (
    <div className="space-y-5" role="status" aria-busy="true" aria-label="Loading scenario">
      <ScenarioCrumbLoading />
      <div className={`p-5 ${card}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Sk className="h-7 w-56" />
            <Sk className="h-4 w-3/4" />
          </div>
          <Sk className="hidden h-control w-32 rounded-lg md:block" />
        </div>
        <div className="mt-4 rounded-lg border-l-2 border-accent-500 bg-surface-secondary p-3">
          <p className={`mb-1 ${caption}`}>When this fires</p>
          <Sk className="h-3.5 w-2/3" />
        </div>
        <div className="mt-4">
          <p className={`mb-2 ${caption}`}>Scenario default parameters</p>
          <div className="space-y-2 rounded-lg bg-surface-secondary p-3">
            <Sk className="h-3 w-1/2" />
            <Sk className="h-3 w-2/5" />
            <Sk className="h-3 w-1/3" />
          </div>
        </div>
      </div>
      <div>
        <h2 className="mb-3 text-lg font-semibold text-foreground">Campaigns using this scenario</h2>
        <div className="space-y-4">
          {[0, 1].map(i => (
            <div key={i} className={`space-y-3 p-5 ${card}`}>
              <div className="flex items-start justify-between gap-4">
                <Sk className="h-4 w-48" />
                <Sk className="h-7 w-24 rounded-lg" />
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                {['Sent', 'Opened', 'Clicked', 'Converted'].map(l => (
                  <span key={l} className="flex items-center gap-1">
                    <span className="text-foreground-muted">{l}: </span>
                    <Sk className="h-3 w-10" />
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function NewScenarioLoading() {
  return (
    <div className="space-y-5" role="status" aria-busy="true" aria-label="Loading new scenario">
      <ScenarioCrumbLoading current="New scenario" />
      <div className={`p-5 ${card}`}>
        <div className="mb-1 flex items-center gap-2">
          {['Describe', 'Review SQL', 'Dry run', 'Save'].map((l, i) => (
            <div key={l} className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${i === 0 ? 'bg-accent-500 text-white' : 'bg-surface-secondary text-foreground-muted'}`}>{i + 1}</span>
              <span className={`text-xs font-medium ${i === 0 ? 'text-foreground' : 'text-foreground-muted'}`}>{l}</span>
              {i < 3 && <span className="h-px w-6 bg-border-default" />}
            </div>
          ))}
        </div>
      </div>
      <div className={`space-y-4 p-5 ${card}`}>
        <div>
          <h2 className="text-lg font-bold text-foreground">Describe the audience</h2>
          <p className="mt-1 text-sm text-foreground-secondary">
            In plain English, describe which customers should receive this campaign and when. AI will translate it into a safe SQL query you can review before saving.
          </p>
        </div>
        <div>
          <p className="mb-1 block text-xs font-semibold uppercase tracking-wide text-foreground-muted">Audience description</p>
          <Sk className="h-28 rounded-lg" />
        </div>
      </div>
    </div>
  )
}
