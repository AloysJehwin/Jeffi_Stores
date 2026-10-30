import { redirect, notFound } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { queryOne } from '@/lib/shared/db'
import BrandForm from '@/components/admin/BrandForm'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import { Badge, FormPage, PageHeader } from '@/components/admin/kit'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { hasScope } from '@/lib/auth/scopes'
import { updateBrand } from './actions'
import { initialDraftLock } from '@/lib/admin/draft-locks'
import { draftBehind, draftsOf, getDraftRow } from '@/lib/admin/draft-branches'
import { brandDrafts } from '@/lib/catalog/brand-draft'
import DraftBehindBanner from '@/components/admin/drafts/DraftBehindBanner'
import MergeOnLoad from '@/components/admin/drafts/MergeOnLoad'

async function getBrand(id: string) {
  const data = await queryOne('SELECT * FROM brands WHERE id = $1', [id])
  if (!data) throw new Error('Brand not found')
  return data
}

export default async function EditBrandPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const { id } = await params
  const { back, draft, merge } = await searchParams
  const brand = await getBrand(id).catch(() => null)
  if (!brand) notFound()

  const host = await getHost()

  // Editing ALWAYS goes through a draft (?draft=<id>). Without one, open the admin's own draft;
  // otherwise the detail page lists the open drafts and starts a new one.
  let draftRow = draft ? await getDraftRow(brandDrafts, draft) : null
  if (draftRow && draftRow.brand_id !== id) draftRow = null
  const isDraft = !!draftRow
  // A create-draft brand (is_draft = true) has no brand_drafts row and is edited in place.
  const isCreateDraft = !isDraft && !!(brand as { is_draft?: boolean }).is_draft
  const session = await getAdminSession()
  if (!isDraft && !isCreateDraft) {
    const mine = session ? (await draftsOf(brandDrafts, id)).find(d => d.authorId === session.adminId) : null
    const qs = new URLSearchParams({ ...(back ? { back } : {}), ...(mine ? { draft: mine.id } : {}) }).toString()
    redirect(ap(mine ? `/admin/brands/${id}/edit?${qs}` : `/admin/brands/${id}/view${back ? `?back=${encodeURIComponent(back)}` : ''}`, host))
  }

  const brandForForm = draftRow?.fields ? { ...brand, ...draftRow.fields } : brand
  const lockId = isDraft ? (draftRow!.id as string) : id
  const [behind, siblings] = isDraft
    ? await Promise.all([draftBehind(brandDrafts, lockId), draftsOf(brandDrafts, id).then(d => d.length - 1)])
    : [null, 0]

  const hasReturns = hasScope(session?.role ?? '', session?.scopes ?? [], 'returns:read')

  const backUrl = back && back.startsWith('/admin/brands') ? back : '/admin/brands'

  const initialLock = await initialDraftLock('brand', lockId)
  const editHref = `/admin/brands/${id}/edit?draft=${lockId}`

  return (
    <MobileEditBlock>
      <FormPage
        header={
          <PageHeader
            back={{ href: ap(backUrl, host), label: 'Brands' }}
            title={isCreateDraft ? 'Edit Draft Brand' : isDraft ? (draftRow!.title ? `Edit Draft · ${draftRow!.title}` : 'Edit Draft') : 'Edit Brand'}
            description={isDraft || isCreateDraft ? 'Changes are saved to the draft only' : 'Update brand information'}
            badges={(isDraft || isCreateDraft) && <Badge tone="amber">Draft</Badge>}
          />
        }
      >
        {isDraft && merge === '1' && (
          <MergeOnLoad
            publishPath={`/api/admin/brands/${id}/publish?draft=${lockId}`}
            doneHref={ap('/admin/brands', host)}
            closeHref={ap(editHref, host)}
          />
        )}
        {isDraft && <DraftBehindBanner info={behind} siblings={siblings} noun="brand" />}
        <BrandForm
          initialLock={initialLock}
          lockId={lockId}
          brand={brandForForm}
          action={updateBrand.bind(null, id, isDraft ? lockId : null)}
          backUrl={backUrl}
          isDraft={isDraft || isCreateDraft}
          hasReturns={hasReturns}
          discardAction={isDraft ? updateBrand.bind(null, id, lockId) : undefined}
        />
      </FormPage>
    </MobileEditBlock>
  )
}
