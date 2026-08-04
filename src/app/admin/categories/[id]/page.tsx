import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { queryOne, queryMany } from '@/lib/db'
import DraftEditButton from '@/components/admin/DraftEditButton'

export const dynamic = 'force-dynamic'

interface Category {
  id: string
  name: string
  slug: string
  description: string | null
  image_url: string | null
  parent_category_id: string | null
  display_order: number
  is_active: boolean
  created_at: string
  sku_prefix: string | null
  google_product_category: string | null
  icon_name: string | null
  return_allowed: boolean | null
  return_window_days: number | null
  replacement_allowed: boolean | null
  replacement_window_days: number | null
}

interface ProductRow {
  id: string
  name: string
  sku: string
  is_active: boolean
  base_price: number
}

interface SubRow {
  id: string
  name: string
  slug: string
  is_active: boolean
  display_order: number
}

export default async function CategoryViewPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ back?: string }>
}) {
  const { id } = await params
  const { back } = await searchParams
  const host = await getHost()
  const backUrl = back && back.startsWith('/admin/categories') ? back : '/admin/categories'

  const category = await queryOne<Category>('SELECT * FROM categories WHERE id = $1', [id])
  if (!category) notFound()

  const [hasDraft, parent, subcategories, products, counts] = await Promise.all([
    queryOne<{ category_id: string }>('SELECT category_id FROM category_drafts WHERE category_id = $1', [id]),
    category.parent_category_id
      ? queryOne<{ id: string; name: string; return_allowed: boolean | null; return_window_days: number | null; replacement_allowed: boolean | null; replacement_window_days: number | null }>(
          'SELECT id, name, return_allowed, return_window_days, replacement_allowed, replacement_window_days FROM categories WHERE id = $1', [category.parent_category_id])
      : Promise.resolve(null),
    queryMany<SubRow>(
      'SELECT id, name, slug, is_active, display_order FROM categories WHERE parent_category_id = $1 ORDER BY display_order, name', [id]
    ),
    queryMany<ProductRow>(
      'SELECT id, name, sku, is_active, base_price FROM products WHERE category_id = $1 ORDER BY name LIMIT 20', [id]
    ),
    queryOne<{ total: string }>('SELECT COUNT(*)::text AS total FROM products WHERE category_id = $1', [id]),
  ])

  const totalProducts = parseInt(counts?.total || '0', 10)
  const isInherited = !!category.parent_category_id && category.return_allowed == null

  const effReturnAllowed = category.return_allowed ?? parent?.return_allowed ?? true
  const effReturnDays = category.return_window_days ?? parent?.return_window_days ?? 7
  const effReplaceAllowed = category.replacement_allowed ?? parent?.replacement_allowed ?? true
  const effReplaceDays = category.replacement_window_days ?? parent?.replacement_window_days ?? 7

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={ap(backUrl, host)} className="text-foreground-muted hover:text-foreground transition-colors flex-shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground">{category.name}</h1>
              <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${category.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
                {category.is_active ? 'Active' : 'Inactive'}
              </span>
              {category.parent_category_id
                ? <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">Subcategory</span>
                : <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">Main</span>}
              {hasDraft && (
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Draft pending</span>
              )}
            </div>
            {category.description && <p className="text-sm text-foreground-secondary mt-1">{category.description}</p>}
            <p className="text-xs text-foreground-muted mt-0.5">Created {new Date(category.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
          </div>
        </div>
        <DraftEditButton entity="categories" id={id} name={category.name} hasDraft={!!hasDraft} backUrl={backUrl} />
      </div>

      {hasDraft && (
        <div className="mb-6 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-amber-800 dark:text-amber-200">This category has unpublished draft changes. Click <span className="font-semibold">Edit Draft</span> to review and publish them.</p>
        </div>
      )}

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4">
          <p className="text-xs text-foreground-secondary">Total Products</p>
          <p className="text-2xl font-bold text-foreground mt-1">{totalProducts}</p>
        </div>
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4">
          <p className="text-xs text-foreground-secondary">Subcategories</p>
          <p className="text-2xl font-bold text-foreground mt-1">{subcategories.length}</p>
        </div>
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4">
          <p className="text-xs text-foreground-secondary">Display Order</p>
          <p className="text-2xl font-bold text-foreground mt-1">{category.display_order}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: details */}
        <div className="space-y-6">
          <div className="bg-surface-elevated rounded-lg border border-border-default overflow-hidden">
            <div className="px-5 py-3 border-b border-border-default bg-surface-secondary">
              <h2 className="text-sm font-semibold text-foreground">Category Details</h2>
            </div>
            <div className="px-5 divide-y divide-border-default">
              {[
                ['Slug', <span key="slug" className="font-mono">{category.slug}</span>],
                ['Parent', parent
                  ? <Link key="parent" href={ap(`/admin/categories/${parent.id}`, host)} className="text-accent-500 hover:underline">{parent.name}</Link>
                  : '— (top level)'],
                ['SKU Prefix', category.sku_prefix || '—'],
                ['Google Category', category.google_product_category || '—'],
                ['Icon', category.icon_name || '—'],
                ['Policy Source', isInherited
                  ? <span key="policy" className="text-blue-600 dark:text-blue-400">Inherited from {parent?.name ?? 'parent'}</span>
                  : <span key="policy">Overridden</span>],
                ['Returns', effReturnAllowed ? `${effReturnDays} days` : 'Not allowed'],
                ['Replacement', effReplaceAllowed ? `${effReplaceDays} days` : 'Not allowed'],
              ].map(([label, value], i) => (
                <div key={i} className="flex items-center justify-between py-2.5 gap-4">
                  <span className="text-sm text-foreground-secondary flex-shrink-0">{label}</span>
                  <span className="text-sm text-foreground font-medium text-right break-all">{value as ReactNode}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: subcategories + products */}
        <div className="lg:col-span-2 space-y-6">
          {subcategories.length > 0 && (
            <div className="bg-surface-elevated rounded-lg border border-border-default overflow-hidden">
              <div className="px-5 py-3 border-b border-border-default bg-surface-secondary flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">Subcategories</h2>
                <span className="text-xs text-foreground-muted">{subcategories.length}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary/50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">Slug</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">Order</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {subcategories.map(s => (
                      <tr key={s.id} className="hover:bg-surface-secondary/40">
                        <td className="px-4 py-2.5">
                          <Link href={ap(`/admin/categories/${s.id}`, host)} className="font-medium text-accent-500 hover:underline">{s.name}</Link>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-foreground-muted">{s.slug}</td>
                        <td className="px-4 py-2.5 text-foreground-muted">{s.display_order}</td>
                        <td className="px-4 py-2.5">
                          {s.is_active
                            ? <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">Active</span>
                            : <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-surface-secondary text-foreground-muted">Inactive</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bg-surface-elevated rounded-lg border border-border-default overflow-hidden">
            <div className="px-5 py-3 border-b border-border-default bg-surface-secondary flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Products</h2>
              <span className="text-xs text-foreground-muted">{totalProducts > 20 ? `Showing 20 of ${totalProducts}` : `${totalProducts} product${totalProducts !== 1 ? 's' : ''}`}</span>
            </div>
            {products.length === 0 ? (
              <p className="px-5 py-6 text-sm text-foreground-muted text-center">No products assigned to this category.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary/50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">Product</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">SKU</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">Price</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {products.map(p => (
                      <tr key={p.id} className="hover:bg-surface-secondary/40">
                        <td className="px-4 py-2.5">
                          <Link href={ap(`/admin/products/${p.id}`, host)} className="font-medium text-accent-500 hover:underline">{p.name}</Link>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-foreground-muted">{p.sku}</td>
                        <td className="px-4 py-2.5 font-semibold text-foreground">₹{Number(p.base_price).toLocaleString('en-IN')}</td>
                        <td className="px-4 py-2.5">
                          {p.is_active
                            ? <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">Active</span>
                            : <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-surface-secondary text-foreground-muted">Inactive</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
