import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import SupplierDetailClient from '../SupplierDetailClient'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { adminCookieName } from '@/lib/auth/admin-cookie'
import { queryOne } from '@/lib/shared/db'
import { startSupplierDraft } from './actions'

export const dynamic = 'force-dynamic'

export default async function SupplierViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const host = await getHost()
  const cookieStore = await cookies()
  const token = cookieStore.get(await adminCookieName())
  if (!token) redirect(ap('/admin/login', host))

  try {
    await verifyToken(token.value)
  } catch {
    redirect(ap('/admin/login', host))
  }

  const draftRow = await queryOne<{ supplier_id: string }>(
    `SELECT supplier_id FROM supplier_drafts WHERE supplier_id = $1`,
    [id]
  )
  const hasDraft = !!draftRow

  return <SupplierDetailClient id={id} hasDraft={hasDraft} startDraftAction={startSupplierDraft.bind(null, id)} />
}
