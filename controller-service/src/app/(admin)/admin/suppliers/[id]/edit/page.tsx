import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { queryOne } from '@/lib/shared/db'
import EditSupplierClient from './EditSupplierClient'
import { initialDraftLock } from '@/lib/admin/draft-locks'

export const dynamic = 'force-dynamic'

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const host = await getHost()

  const draftRow = await queryOne<{ supplier_id: string }>(
    `SELECT supplier_id FROM supplier_drafts WHERE supplier_id = $1`,
    [id]
  )
  if (!draftRow) {
    redirect(ap(`/admin/suppliers/${id}/view`, host))
  }

  return <EditSupplierClient id={id} initialLock={await initialDraftLock('supplier', id)} />
}
