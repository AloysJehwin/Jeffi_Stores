import { ConsoleLoading, LinesLoading, PillLoading, Sk } from '../../../_components/Skeleton'

export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Showcase" title="Enquiries">
      <div className="space-y-4">
        <div className="flex gap-2">
          <PillLoading className="w-20" />
          <PillLoading className="w-24" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <section key={i} className="rounded-2xl border border-border-default bg-surface-elevated p-5">
            <Sk className="h-4 w-40" />
            <Sk className="mt-2 h-3 w-28" />
            <div className="mt-4">
              <LinesLoading lines={2} />
            </div>
          </section>
        ))}
      </div>
    </ConsoleLoading>
  )
}
