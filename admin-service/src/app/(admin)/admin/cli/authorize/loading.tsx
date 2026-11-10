import { Card } from '@/components/admin/kit/layout'
import { LoadingFacts, PageLoading, Sk } from '@/components/admin/kit/skeleton'

const ACCESS = [
  ['Read only', 'Every :read permission you hold'],
  ['Everything you can do', 'Follows your permissions, including later changes'],
  ['Specific scopes', 'A list such as products:write orders:read'],
]

export default function Loading() {
  return (
    <PageLoading
      title="Authorize the command line"
      description="A terminal running jeffi login asked to sign in to this store as you. Approve it only if you started it."
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card title="Code">
            <p className="text-sm text-foreground-muted">Code shown in your terminal</p>
            <Sk className="mt-1 h-control max-w-xs rounded-lg" />
          </Card>
          <Card title="Access">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {ACCESS.map(([label, hint]) => (
                <div key={label} className="flex h-full items-start gap-2 rounded-lg border border-border-default p-3 text-sm">
                  <Sk className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full" />
                  <span>
                    <span className="font-medium text-foreground">{label}</span>
                    <span className="block text-xs text-foreground-muted">{hint}</span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Valid for">
            <Sk className="h-control max-w-xs rounded-lg" />
          </Card>
          <div className="flex flex-wrap gap-2">
            <Sk className="h-control w-24 rounded-lg" />
            <Sk className="h-control w-20 rounded-lg" />
          </div>
        </div>
        <div className="min-w-0 space-y-5">
          <Card title="Request">
            <LoadingFacts labels={['Client', 'From', 'Agent', 'Requested', 'Expires']} />
          </Card>
          <Card title="After you approve">
            <ul className="list-disc space-y-1.5 pl-4 text-sm text-foreground-muted">
              <li>The terminal signs in as you; the token never gets more than your own permissions.</li>
              <li>
                Check it with <code className="font-mono text-foreground">jeffi whoami</code>.
              </li>
              <li>Revoke it any time under Settings → CLI &amp; tokens, or with jeffi logout.</li>
            </ul>
          </Card>
        </div>
      </div>
    </PageLoading>
  )
}
