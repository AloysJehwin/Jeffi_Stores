import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import SupplierDetailClient from '../SupplierDetailClient'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { adminCookieName } from '@/lib/auth/admin-cookie'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { draftsForView } from '@/lib/admin/draft-branches'
import { supplierDrafts } from '@/lib/admin/supplier-drafts'
import EntityDrafts from '@/components/admin/drafts/EntityDrafts'
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

  const me = (await getAdminSession())?.adminId ?? null
  const drafts = await draftsForView(supplierDrafts, id, me)
  const start = startSupplierDraft.bind(null, id)

  return (
    <SupplierDetailClient
      id={id}
      draftCount={drafts.length}
      myDraft={drafts.some(d => d.authorId === me)}
      startDraftAction={start}
      draftsNotice={drafts.length > 0 && <EntityDrafts drafts={drafts} start={start} back="/admin/suppliers?tab=suppliers&active=true" me={me} noun="supplier" />}
    />
  )
}
