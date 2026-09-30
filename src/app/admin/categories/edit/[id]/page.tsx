import { redirect, notFound } from 'next/navigation'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { getAllCategories } from '@/lib/queries'
import { queryOne } from '@/lib/db'
import CategoryForm from '@/components/admin/CategoryForm'
import { ChevronLeft } from 'lucide-react'
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
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <a
          href={ap(backUrl, host)}
          className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Categories
        </a>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium">
          {isCreateDraft ? 'Edit Draft Category' : isDraft ? 'Edit Draft' : 'Edit Category'}
        </span>
      </div>

      {isCreateDraft && (
        <div className="mb-6 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">New category — draft</p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
            This category is not on the live list yet. Save keeps it a draft; Publish makes it live.
          </p>
        </div>
      )}

      {isDraft && (
        <div className="mb-6 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Draft pending</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              Changes are saved to draft. The live category stays unchanged until you publish.
            </p>
          </div>
          <form action={updateCategory.bind(null, id)}>
            <input type="hidden" name="intent" value="discard" />
            <button type="submit" className="text-xs text-amber-600 hover:underline ml-4">
              Discard draft
            </button>
          </form>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">
          {isCreateDraft ? 'Edit Draft Category' : isDraft ? 'Edit Draft' : 'Edit Category'}
        </h1>
        <p className="text-foreground-secondary mt-1">
          {isDraft || isCreateDraft ? 'Changes are saved to the draft only' : 'Update category information'}
        </p>
      </div>

      <CategoryForm
        categories={categories || []}
        category={categoryForForm}
        action={updateCategory.bind(null, id)}
        backUrl={backUrl}
        isDraft={isDraft || isCreateDraft}
      />
    </div>
  )
}
