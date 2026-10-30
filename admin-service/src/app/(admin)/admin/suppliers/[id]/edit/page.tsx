import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import EditSupplierClient from './EditSupplierClient'
import { initialDraftLock } from '@/lib/admin/draft-locks'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { draftBehind, draftsOf, getDraftRow } from '@/lib/admin/draft-branches'
import { supplierDrafts } from '@/lib/admin/supplier-drafts'
import DraftBehindBanner from '@/components/admin/drafts/DraftBehindBanner'

export const dynamic = 'force-dynamic'

export default async function EditSupplierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const { id } = await params
  const { draft } = await searchParams
  const host = await getHost()

  // Editing always goes through a draft (?draft=<id>): without one, open the admin's own draft,
  // else the view page lists the open drafts and starts a new one.
  let draftRow = draft ? await getDraftRow(supplierDrafts, draft) : null
  if (draftRow && draftRow.supplier_id !== id) draftRow = null
  if (!draftRow) {
    const session = await getAdminSession()
    const mine = session ? (await draftsOf(supplierDrafts, id)).find(d => d.authorId === session.adminId) : null
    redirect(ap(mine ? `/admin/suppliers/${id}/edit?draft=${mine.id}` : `/admin/suppliers/${id}/view`, host))
  }

  const draftId = draftRow.id as string
  const [initialLock, behind, siblings] = await Promise.all([
    initialDraftLock('supplier', draftId),
    draftBehind(supplierDrafts, draftId),
    draftsOf(supplierDrafts, id).then(d => d.length - 1),
  ])

  return (
    <EditSupplierClient
      id={id}
      draftId={draftId}
      draftTitle={draftRow.title ?? null}
      initialLock={initialLock}
      notice={<DraftBehindBanner info={behind} siblings={siblings} noun="supplier" />}
    />
  )
}
