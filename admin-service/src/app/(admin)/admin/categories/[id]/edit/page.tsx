import { redirect, notFound } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { getAllCategories } from '@/lib/queries'
import { queryOne } from '@/lib/shared/db'
import CategoryForm from '@/components/admin/CategoryForm'
import { Badge, FormPage, PageHeader } from '@/components/admin/kit'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import { updateCategory } from './actions'
import { initialDraftLock } from '@/lib/admin/draft-locks'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { draftBehind, draftsOf, getDraftRow } from '@/lib/admin/draft-branches'
import { categoryDrafts } from '@/lib/catalog/category-draft'
import DraftBehindBanner from '@/components/admin/drafts/DraftBehindBanner'
import MergeOnLoad from '@/components/admin/drafts/MergeOnLoad'

async function getCategory(id: string) {
  const data = await queryOne('SELECT * FROM categories WHERE id = $1', [id])
  if (!data) throw new Error('Category not found')
  return data
}

export default async function EditCategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const { id } = await params
  const { back, draft, merge } = await searchParams
  const category = await getCategory(id).catch(() => null)
  if (!category) notFound()

  const host = await getHost()

  // Editing ALWAYS goes through a draft (?draft=<id>). Without one, open the admin's own draft;
  // otherwise the detail page lists the open drafts and starts a new one.
  let draftRow = draft ? await getDraftRow(categoryDrafts, draft) : null
  if (draftRow && draftRow.category_id !== id) draftRow = null
  const isDraft = !!draftRow
  // A create-draft category (is_draft = true) has no category_drafts row and is edited in place.
  const isCreateDraft = !isDraft && !!(category as { is_draft?: boolean }).is_draft
  if (!isDraft && !isCreateDraft) {
    const session = await getAdminSession()
    const mine = session ? (await draftsOf(categoryDrafts, id)).find(d => d.authorId === session.adminId) : null
    const qs = new URLSearchParams({ ...(back ? { back } : {}), ...(mine ? { draft: mine.id } : {}) }).toString()
    redirect(ap(mine ? `/admin/categories/${id}/edit?${qs}` : `/admin/categories/${id}${back ? `?back=${encodeURIComponent(back)}` : ''}`, host))
  }

  const categoryForForm = draftRow?.fields ? { ...category, ...draftRow.fields } : category
  const lockId = isDraft ? (draftRow!.id as string) : id
  const [behind, siblings] = isDraft
    ? await Promise.all([draftBehind(categoryDrafts, lockId), draftsOf(categoryDrafts, id).then(d => d.length - 1)])
    : [null, 0]

  const categories = await getAllCategories()
  const backUrl = back && back.startsWith('/admin/categories') ? back : '/admin/categories'

  const initialLock = await initialDraftLock('category', lockId)
  const editHref = `/admin/categories/${id}/edit?draft=${lockId}`

  return (
    <MobileEditBlock>
    <FormPage
      header={
        <PageHeader
          back={{ href: ap(backUrl, host), label: 'Categories' }}
          title={isCreateDraft ? 'Edit Draft Category' : isDraft ? (draftRow!.title ? `Edit Draft · ${draftRow!.title}` : 'Edit Draft') : 'Edit Category'}
          description={isDraft || isCreateDraft ? 'Changes are saved to the draft only' : 'Update category information'}
          badges={isDraft || isCreateDraft ? <Badge tone="amber">{isCreateDraft ? 'New draft' : 'Draft pending'}</Badge> : undefined}
        />
      }
    >
      {isDraft && merge === '1' && (
        <MergeOnLoad
          publishPath={`/api/admin/categories/${id}/publish?draft=${lockId}`}
          doneHref={ap('/admin/categories', host)}
          closeHref={ap(editHref, host)}
        />
      )}
      {isDraft && <DraftBehindBanner info={behind} siblings={siblings} noun="category" />}
      <CategoryForm
        initialLock={initialLock}
        lockId={lockId}
        categories={categories || []}
        category={categoryForForm}
        action={updateCategory.bind(null, id, isDraft ? lockId : null)}
        backUrl={backUrl}
        isDraft={isDraft || isCreateDraft}
        discardAction={isDraft ? updateCategory.bind(null, id, lockId) : undefined}
      />
    </FormPage>
    </MobileEditBlock>
  )
}
