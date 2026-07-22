import { redirect, notFound } from 'next/navigation'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { revalidatePath } from 'next/cache'
import { getAllCategories } from '@/lib/queries'
import { query, queryOne } from '@/lib/db'
import { publishCategoryDraft } from '@/lib/category-draft'
import CategoryForm from '@/components/admin/CategoryForm'
import CategoryHeroImages from '@/components/admin/CategoryHeroImages'
import { suggestIcon } from '@/lib/iconSuggest'
import { ChevronLeft } from 'lucide-react'

async function getCategory(id: string) {
  const data = await queryOne('SELECT * FROM categories WHERE id = $1', [id])
  if (!data) throw new Error('Category not found')
  return data
}

async function updateCategory(categoryId: string, formData: FormData) {
  'use server'

  const name = formData.get('name') as string
  const description = formData.get('description') as string || null
  const parentCategoryId = formData.get('parent_id') as string || null
  const displayOrder = parseInt(formData.get('display_order') as string)
  const skuPrefix = (formData.get('sku_prefix') as string || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null
  const isActive = formData.get('is_active') === 'true'
  const policyOverride = formData.get('policy_override') === 'true'
  const returnAllowed = policyOverride ? (formData.get('return_allowed') !== 'false') : null
  const returnWindowDays = policyOverride ? Math.max(1, parseInt(formData.get('return_window_days') as string) || 7) : null
  const replacementAllowed = policyOverride ? (formData.get('replacement_allowed') !== 'false') : null
  const replacementWindowDays = policyOverride ? Math.max(1, parseInt(formData.get('replacement_window_days') as string) || 7) : null
  const googleProductCategory = formData.get('google_product_category') as string || null
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const manualIcon = (formData.get('icon_name') as string || '').trim()
  const iconName = manualIcon || await suggestIcon(name)
  const intent = formData.get('intent') as string | null

  const draftRow = await queryOne<{ category_id: string }>(
    `SELECT category_id FROM category_drafts WHERE category_id = $1`, [categoryId]
  )
  const hasDraft = !!draftRow

  const draftFields = {
    name, slug, description, parent_category_id: parentCategoryId,
    display_order: displayOrder, sku_prefix: skuPrefix, is_active: isActive,
    policy_override: policyOverride, return_allowed: returnAllowed,
    return_window_days: returnWindowDays, replacement_allowed: replacementAllowed,
    replacement_window_days: replacementWindowDays,
    google_product_category: googleProductCategory, icon_name: iconName,
  }

  const host = await getHost()

  if (hasDraft || intent === 'draft') {
    if (intent === 'discard') {
      await query(`DELETE FROM category_drafts WHERE category_id = $1`, [categoryId])
      revalidatePath(`/admin/categories/edit/${categoryId}`)
      redirect(ap(`/admin/categories/edit/${categoryId}`, host))
    }

    // Save to draft
    await query(
      `INSERT INTO category_drafts (category_id, fields, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (category_id) DO UPDATE SET fields = EXCLUDED.fields, updated_at = NOW()`,
      [categoryId, JSON.stringify(draftFields)]
    )

    if (intent === 'publish') {
      await publishCategoryDraft(categoryId)
      revalidatePath('/admin/categories')
      revalidatePath(`/admin/categories/edit/${categoryId}`)
      redirect(ap(`/admin/categories`, host))
    }

    revalidatePath(`/admin/categories/edit/${categoryId}`)
    const back = formData.get('_back') as string | null
    redirect(ap(back && back.startsWith('/admin/categories') ? back : `/admin/categories/edit/${categoryId}`, host))
  }

  // No draft — direct live update (inactive categories or first time)
  const existing = await queryOne<any>('SELECT is_active FROM categories WHERE id = $1', [categoryId])
  await query(
    `UPDATE categories SET
      name = $1, slug = $2, description = $3, parent_category_id = $4,
      sku_prefix = $5, display_order = $6, is_active = $7, google_product_category = $8,
      icon_name = $9, return_allowed = $10, return_window_days = $11,
      replacement_allowed = $12, replacement_window_days = $13, updated_at = $14
    WHERE id = $15`,
    [name, slug, description, parentCategoryId, skuPrefix, displayOrder, isActive, googleProductCategory, iconName, returnAllowed, returnWindowDays, replacementAllowed, replacementWindowDays, new Date().toISOString(), categoryId]
  )
  if (existing && existing.is_active !== isActive) {
    await query('UPDATE products SET is_active = $1 WHERE category_id = $2', [isActive, categoryId])
    const subcatResult = await query<{ id: string }>('SELECT id FROM categories WHERE parent_category_id = $1', [categoryId])
    for (const sub of subcatResult.rows) {
      await query('UPDATE products SET is_active = $1 WHERE category_id = $2', [isActive, sub.id])
    }
  }
  revalidatePath('/admin/categories')
  revalidatePath('/admin/categories/edit/[id]', 'page')
  const back = formData.get('_back') as string | null
  redirect(ap(back && back.startsWith('/admin/categories') ? back : '/admin/categories', host))
}

export default async function EditCategoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const { id } = await params
  const { back } = await searchParams
  const category = await getCategory(id).catch(() => null)
  if (!category) notFound()

  let draftRow = await queryOne<{ category_id: string; fields: Record<string, unknown> }>(
    `SELECT category_id, fields FROM category_drafts WHERE category_id = $1`, [id]
  )

  // Auto-create draft for active categories on first edit visit
  if (!draftRow && category.is_active) {
    await query(
      `INSERT INTO category_drafts (category_id, fields)
       SELECT id, to_jsonb(c) - 'id' - 'created_at' - 'updated_at' - 'search_vector'
       FROM categories c WHERE c.id = $1
       ON CONFLICT (category_id) DO NOTHING`,
      [id]
    )
    draftRow = await queryOne<{ category_id: string; fields: Record<string, unknown> }>(
      `SELECT category_id, fields FROM category_drafts WHERE category_id = $1`, [id]
    )
  }

  const isDraft = !!draftRow
  const categoryForForm = isDraft && draftRow?.fields
    ? { ...category, ...draftRow.fields }
    : category

  const host = await getHost()
  const categories = await getAllCategories()
  const backUrl = back && back.startsWith('/admin/categories') ? back : '/admin/categories'

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <a href={ap(backUrl, host)} className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Categories
        </a>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium">{isDraft ? 'Edit Draft' : 'Edit Category'}</span>
      </div>

      {isDraft && (
        <div className="mb-6 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Draft pending</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">Changes are saved to draft. The live category stays unchanged until you publish.</p>
          </div>
          <form action={updateCategory.bind(null, id)}>
            <input type="hidden" name="intent" value="discard" />
            <button type="submit" className="text-xs text-amber-600 hover:underline ml-4">Discard draft</button>
          </form>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">{isDraft ? 'Edit Draft' : 'Edit Category'}</h1>
        <p className="text-foreground-secondary mt-1">{isDraft ? 'Changes are saved to the draft only' : 'Update category information'}</p>
      </div>

      <CategoryForm
        categories={categories || []}
        category={categoryForForm}
        action={updateCategory.bind(null, id)}
        backUrl={backUrl}
        isDraft={isDraft}
      />

      {!category.parent_category_id && (
        <div className="mt-6">
          <CategoryHeroImages
            categoryId={id}
            mobileImage={(category as any).hero_image_mobile ?? null}
            desktopImage={(category as any).hero_image_desktop ?? null}
          />
        </div>
      )}
    </div>
  )
}

