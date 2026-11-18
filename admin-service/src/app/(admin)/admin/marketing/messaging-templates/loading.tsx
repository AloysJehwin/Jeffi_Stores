import { PageLoading, Sk } from '@/components/admin/kit/skeleton'
import { EMBEDDED_PAGE_SIZE } from '@/components/admin/kit/page-size'
import { LoadingTabBar } from '../../products/_components/loading-parts'

// The description and the SMS / WhatsApp tabs follow Site Controls, so only Email is drawn.
export default function Loading() {
  return (
    <PageLoading title="Templates" description={<Sk className="mt-1 h-3.5 w-96 max-w-full" />}>
      <LoadingTabBar tabs={['Email']} actions={1} />
      <div
        className="admin-split grid grid-cols-1 items-start gap-5 lg:grid-cols-[320px_1fr]"
        style={{ '--admin-split-offset': '15.5rem' } as React.CSSProperties}
      >
        <div className="overflow-hidden rounded-lg border border-border-default bg-surface-elevated lg:flex lg:max-h-full lg:flex-col">
          <div className="border-b border-border-default p-3">
            <Sk className="h-control rounded-lg" />
          </div>
          <div className="admin-pane">
            {Array.from({ length: EMBEDDED_PAGE_SIZE }).map((_, i) => (
              <div key={i} className="space-y-2 border-b border-border-default px-4 py-3 last:border-0">
                <Sk className="h-3.5 w-2/3" />
                <Sk className="h-3 w-1/3" />
              </div>
            ))}
          </div>
        </div>
        <div className="admin-pane rounded-lg border border-border-default bg-surface-elevated p-6 lg:max-h-full">
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-foreground">Select a template to edit</p>
            <p className="mt-1 text-xs text-foreground-muted">Standard templates are shared by every store; saving creates this tenant’s own copy.</p>
          </div>
        </div>
      </div>
    </PageLoading>
  )
}
