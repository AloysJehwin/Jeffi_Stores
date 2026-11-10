import { LoadingCards, LoadingTabs, PageLoading, Sk } from '@/components/admin/kit/skeleton'

// Segmented control (Store / Business, Desktop web / Mobile web / App) with the first option on.
function Segments({ items }: { items: string[] }) {
  return (
    <div className="flex h-control w-fit gap-0.5 rounded-lg border border-border-default bg-surface-elevated p-0.5">
      {items.map((t, i) => (
        <span key={t} className={`flex items-center rounded-md px-3 text-xs font-medium ${i === 0 ? 'bg-accent-500 text-white' : 'text-foreground-muted'}`}>
          {t}
        </span>
      ))}
    </div>
  )
}

export default function Loading() {
  return (
    <PageLoading title="Homepage" description={<Sk className="mt-1 h-3.5 w-full max-w-2xl" />}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="control-sm inline-flex items-center rounded-md bg-surface-secondary text-xs font-medium text-foreground">Live homepage</span>
        <span className="control-sm inline-flex items-center rounded-md text-xs font-medium text-foreground-muted">Drafts</span>
      </div>
      <section className="rounded-xl border border-border-default bg-surface-elevated px-4 py-3">
        <p className="text-sm font-semibold text-foreground">You are looking at the live homepage</p>
        <p className="text-xs text-foreground-muted">
          Edits go into a draft and reach the store only when you publish. Several admins can each work on their own draft.
        </p>
      </section>
      <Segments items={['Store', 'Business']} />
      <LoadingTabs tabs={['Home', 'All products', 'Category pages', 'Brand pages']} />
      <Segments items={['Desktop web', 'Mobile web', 'App']} />
      <LoadingCards count={6} cols={2} height="h-20" />
    </PageLoading>
  )
}
