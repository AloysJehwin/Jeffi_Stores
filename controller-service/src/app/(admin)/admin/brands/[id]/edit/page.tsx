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
  const { back } = await searchParams
  const brand = await getBrand(id).catch(() => null)
  if (!brand) notFound()

  const host = await getHost()

  // Editing ALWAYS goes through a draft. Direct navigation to the edit URL for a
  // brand with no draft (active or inactive) redirects to the detail page, where
  // the Edit button creates a draft first. The live brand is never edited directly.
  const draftRow = await queryOne<{ brand_id: string; fields: Record<string, unknown> }>(
    `SELECT brand_id, fields FROM brand_drafts WHERE brand_id = $1`,
    [id]
  )
  const isDraft = !!draftRow
  // A create-draft brand (is_draft = true) has no brand_drafts row but must still render its
  // edit form (editing in place) rather than bouncing to the detail page.
  const isCreateDraft = !isDraft && !!(brand as { is_draft?: boolean }).is_draft
  if (!isDraft && !isCreateDraft) {
    redirect(ap(`/admin/brands/${id}`, host))
  }

  const brandForForm = draftRow?.fields ? { ...brand, ...draftRow.fields } : brand

  const session = await getAdminSession()
  const hasReturns = hasScope(session?.role ?? '', session?.scopes ?? [], 'returns:read')

  const backUrl = back && back.startsWith('/admin/brands') ? back : '/admin/brands'

  return (
    <MobileEditBlock>
      <FormPage
        header={
          <PageHeader
            back={{ href: ap(backUrl, host), label: 'Brands' }}
            title={isCreateDraft ? 'Edit Draft Brand' : isDraft ? 'Edit Draft' : 'Edit Brand'}
            description={isDraft || isCreateDraft ? 'Changes are saved to the draft only' : 'Update brand information'}
            badges={(isDraft || isCreateDraft) && <Badge tone="amber">Draft</Badge>}
          />
        }
      >
        {isDraft && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Draft pending</p>
              <p className="text-xs text-foreground-muted mt-0.5">Changes are saved to draft. The live brand stays unchanged until you publish.</p>
            </div>
            <form action={updateBrand.bind(null, id)}>
              <input type="hidden" name="intent" value="discard" />
              <button type="submit" className="control-sm border border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10">
                Discard draft
              </button>
            </form>
          </div>
        )}

        {isCreateDraft && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">New brand — draft</p>
            <p className="text-xs text-foreground-muted mt-0.5">This brand is not on the live list yet. Save keeps it a draft; Publish makes it live.</p>
          </div>
        )}

        <BrandForm
          brand={brandForForm}
          action={updateBrand.bind(null, id)}
          backUrl={backUrl}
          isDraft={isDraft || isCreateDraft}
          hasReturns={hasReturns}
        />
      </FormPage>
    </MobileEditBlock>
  )
}
