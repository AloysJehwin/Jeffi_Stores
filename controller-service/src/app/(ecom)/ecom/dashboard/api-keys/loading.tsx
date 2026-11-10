import { CardLoading, ConsoleLoading, FieldLoading, SandTableLoading, Sk } from '../_components/Skeleton'

export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Developers" title="API keys" description="Keys for public.jeffistores.in. Each key is shown once — store it somewhere safe.">
      <div className="space-y-6">
        <CardLoading title="Create a key">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-end">
            <FieldLoading label="Name" />
            <Sk className="h-10 w-28 rounded-full" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {Array.from({ length: 5 }).map((_, i) => <Sk key={i} className="h-8 w-28 rounded-full" />)}
          </div>
        </CardLoading>
        <CardLoading title="Keys">
          <SandTableLoading columns={['Name', 'Key', 'Scopes', '30-day use', 'Last used', '']} rows={3} />
        </CardLoading>
      </div>
    </ConsoleLoading>
  )
}
