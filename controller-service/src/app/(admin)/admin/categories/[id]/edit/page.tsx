import { redirect, notFound } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { getAllCategories } from '@/lib/queries'
import { queryOne } from '@/lib/shared/db'
import CategoryForm from '@/components/admin/CategoryForm'
import { Badge, FormPage, PageHeader } from '@/components/admin/kit'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import { updateCategory } from './actions'

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
  const { back } = await searchParams
  const category = await getCategory(id).catch(() => null)
  if (!category) notFound()

  const host = await getHost()

  // Editing ALWAYS goes through a draft. Direct navigation to the edit URL for a
  // category with no draft (active or inactive) redirects to the detail page,
  // where the Edit button creates a draft first. Live category is never edited directly.
  const draftRow = await queryOne<{ category_id: string; fields: Record<string, unknown> }>(
    `SELECT category_id, fields FROM category_drafts WHERE category_id = $1`,
    [id]
  )
  const isDraft = !!draftRow
  // A create-draft category (is_draft = true) has no category_drafts row but must still render
  // its edit form (editing in place) rather than bouncing to the detail page.
  const isCreateDraft = !isDraft && !!(category as { is_draft?: boolean }).is_draft
  if (!isDraft && !isCreateDraft) {
    redirect(ap(`/admin/categories/${id}`, host))
  }

  const categoryForForm = draftRow?.fields ? { ...category, ...draftRow.fields } : category

  const categories = await getAllCategories()
  const backUrl = back && back.startsWith('/admin/categories') ? back : '/admin/categories'

  return (
    <MobileEditBlock>
    <FormPage
      header={
        <PageHeader
          back={{ href: ap(backUrl, host), label: 'Categories' }}
          title={isCreateDraft ? 'Edit Draft Category' : isDraft ? 'Edit Draft' : 'Edit Category'}
          description={isDraft || isCreateDraft ? 'Changes are saved to the draft only' : 'Update category information'}
          badges={isDraft || isCreateDraft ? <Badge tone="amber">{isCreateDraft ? 'New draft' : 'Draft pending'}</Badge> : undefined}
        />
      }
    >
      {isCreateDraft && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-foreground">
          This category is not on the live list yet. Save keeps it a draft; Publish makes it live.
        </div>
      )}

      {isDraft && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-foreground">Changes are saved to draft. The live category stays unchanged until you publish.</p>
          <form action={updateCategory.bind(null, id)}>
            <input type="hidden" name="intent" value="discard" />
            <button type="submit" className="control-sm border border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10">
              Discard draft
            </button>
          </form>
        </div>
      )}

      <CategoryForm
        categories={categories || []}
        category={categoryForForm}
        action={updateCategory.bind(null, id)}
        backUrl={backUrl}
        isDraft={isDraft || isCreateDraft}
      />
    </FormPage>
    </MobileEditBlock>
  )
}
