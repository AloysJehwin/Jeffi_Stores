import { LoadingSection, PageLoading, Sk } from '@/components/admin/kit/skeleton'

const tab = (on: boolean) =>
  `-mb-px inline-flex shrink-0 items-center whitespace-nowrap border-b-2 px-3 py-2 text-sm ${on ? 'border-accent-500 font-medium text-foreground' : 'border-transparent text-foreground-muted'}`

export default function Loading() {
  return (
    <PageLoading
      title="Site Builder"
      description="Every customer page, laid out per device from blocks. Changes are saved as a draft and go live when you publish."
    >
      {/* Tabs row: Site builder / Block builder, the make-live control on the right. */}
      <div className="flex items-end justify-between gap-3 border-b border-border-default">
        <div className="flex min-w-0 gap-1">
          <span className={tab(true)}>Site builder</span>
          <span className={tab(false)}>Block builder</span>
        </div>
        <Sk className="mb-1.5 h-8 w-40 shrink-0 rounded-lg" />
      </div>

      <section className="space-y-3 rounded-xl border border-border-default bg-surface-elevated p-4 sm:p-5">
        <p className="text-sm font-semibold text-foreground">Redesign my whole site with AI</p>
        <Sk className="h-3.5 w-full max-w-2xl" />
        <Sk className="h-3.5 w-1/2 max-w-md" />
        <div className="flex flex-wrap gap-2 pt-1">
          <Sk className="h-control w-40 rounded-lg" />
          <Sk className="h-control w-28 rounded-lg" />
        </div>
      </section>

      <LoadingSection title="You are looking at the live site">
        <Sk className="mb-4 h-3 w-2/3 max-w-lg" />
        <Sk className="h-control w-32 rounded-lg" />
        <div className="mt-5 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Open drafts</p>
          {[0, 1].map(i => (
            <div key={i} className="flex items-center justify-between rounded-lg border border-border-default px-3 py-2.5">
              <Sk className="h-3.5 w-40" />
              <Sk className="h-3 w-28" />
            </div>
          ))}
        </div>
      </LoadingSection>
    </PageLoading>
  )
}
