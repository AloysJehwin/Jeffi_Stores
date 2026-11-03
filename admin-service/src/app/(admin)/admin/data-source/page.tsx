import { PageBody, PageHeader } from '@/components/admin/kit/layout'
import DataSourceClient from './_components/DataSourceClient'
import { resolveImportTenantId, getGsheetStatus } from '@/lib/import/jobs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function DataSourcePage() {
  // The client refetches the status, so a failure here leaves the tab to load it instead of a 500.
  const initialGsheet = await getGsheetStatus(await resolveImportTenantId()).catch(e => {
    console.error('[data-source] status failed', { message: (e as Error)?.message })
    return undefined
  })
  return (
    <PageBody>
      <PageHeader
        title="Data source"
        description="Bulk-import products from a spreadsheet, or sync them from a Google Sheet. New SKUs create products; existing SKUs update them, through the same publish path the editor uses."
      />
      <DataSourceClient initialGsheet={initialGsheet} />
    </PageBody>
  )
}
