import { PageLoading, Sk } from '@/components/admin/kit/skeleton'

// Segmented control (Desktop web / Mobile web / App, Store / Business) with the first option on.
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

const tab = (on: boolean) =>
  `-mb-px inline-flex shrink-0 items-center whitespace-nowrap border-b-2 px-3 py-2 text-sm ${on ? 'border-accent-500 font-medium text-foreground' : 'border-transparent text-foreground-muted'}`

const titles = ['w-32', 'w-24', 'w-20', 'w-28', 'w-36', 'w-40', 'w-44', 'w-36', 'w-32', 'w-28', 'w-36', 'w-32']

export default function Loading() {
  return (
    <PageLoading
      title="Homepage"
      description={
        <>
          <Sk className="mt-1 h-3.5 w-full max-w-5xl" />
          <Sk className="mt-2 h-3.5 w-2/3 max-w-2xl" />
        </>
      }
    >
      {/* One tab line: Live homepage / Drafts, the page tabs, then the device and audience switches. */}
      <div className="flex items-end gap-2 border-b border-border-default">
        <div className="flex min-w-0 flex-1 gap-0.5 overflow-hidden">
          <span className={tab(true)}>Live homepage</span>
          <span className={tab(false)}>Drafts</span>
          <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 self-center bg-border-default" />
          <span className={tab(true)}>Home</span>
          <span className={tab(false)}>All products</span>
          <span className={tab(false)}>Category pages</span>
          <span className={tab(false)}>Brand pages</span>
        </div>
        <div className="hidden shrink-0 items-center gap-1 pb-1 md:flex">
          <Segments items={['Desktop web', 'Mobile web', 'App']} />
          <Segments items={['Store', 'Business']} />
        </div>
      </div>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-default bg-surface-elevated px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">You are looking at the live homepage</p>
          <p className="text-xs text-foreground-muted">
            Edits go into a draft and reach the store only when you publish. Several admins can each work on their own draft.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Sk className="control-sm w-44 rounded-md" />
          <Sk className="control-sm w-20 rounded-md" />
        </div>
      </section>

      {/* Section rows: switch, drag handle, position, title and type, chevron. */}
      <div className="space-y-2">
        {titles.map((w, i) => (
          <div key={i} className="flex items-center gap-2 rounded-lg border border-border-default bg-surface px-3 py-2.5">
            <Sk className="h-5 w-9 shrink-0 rounded-full" />
            <Sk className="h-4 w-4 shrink-0" />
            <Sk className="h-3.5 w-6 shrink-0" />
            <Sk className={`h-4 ${w}`} />
            <Sk className="hidden h-3 w-20 sm:block" />
            <Sk className="ml-auto h-4 w-4 shrink-0" />
            <Sk className="h-5 w-9 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </PageLoading>
  )
}
