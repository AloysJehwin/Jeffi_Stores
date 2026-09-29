import DataSourceClient from './_components/DataSourceClient'
import { resolveImportTenantId, getGsheetStatus } from '@/lib/import/jobs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function DataSourcePage() {
  const initialGsheet = await getGsheetStatus(await resolveImportTenantId())
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Data Source</h1>
        <p className="text-sm text-foreground-secondary mt-1">
          Bulk-import products from a spreadsheet. Download the template, fill in every product,
          variant and sub-variant, add image URLs, and upload. Rows are created or updated by SKU
          through the same publish path the product editor uses.
        </p>
      </div>
      <DataSourceClient initialGsheet={initialGsheet} />
    </div>
  )
}
