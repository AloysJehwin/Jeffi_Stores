import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Info } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { queryOne, queryMany } from '@/lib/shared/db'
import CopySku from '@/components/ui/CopySku'
import { ACTIVE_STATUS, Badge, Card, DetailHeader, EmptyState, EntityPage, Field, Fields, Kpi, KpiGrid, StatusBadge } from '@/components/admin/kit'
import { startCategoryDraft } from './actions'

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

export default async function CategoryViewPage({
  params,
  searchParams,
}: {
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
      ? queryOne<{
          id: string
          name: string
          return_allowed: boolean | null
          return_window_days: number | null
          replacement_allowed: boolean | null
          replacement_window_days: number | null
        }>(
          'SELECT id, name, return_allowed, return_window_days, replacement_allowed, replacement_window_days FROM categories WHERE id = $1',
          [category.parent_category_id]
        )
      : Promise.resolve(null),
    queryMany<SubRow>(
      'SELECT id, name, slug, is_active, display_order FROM categories WHERE parent_category_id = $1 ORDER BY display_order, name',
      [id]
    ),
    queryMany<ProductRow>(
      'SELECT id, name, sku, is_active, base_price FROM products WHERE category_id = $1 ORDER BY name LIMIT 20',
      [id]
    ),
    queryOne<{ total: string }>('SELECT COUNT(*)::text AS total FROM products WHERE category_id = $1', [id]),
  ])

  const totalProducts = parseInt(counts?.total || '0', 10)
  const isInherited = !!category.parent_category_id && category.return_allowed == null

  const effReturnAllowed = category.return_allowed ?? parent?.return_allowed ?? true
  const effReturnDays = category.return_window_days ?? parent?.return_window_days ?? 7
  const effReplaceAllowed = category.replacement_allowed ?? parent?.replacement_allowed ?? true
  const effReplaceDays = category.replacement_window_days ?? parent?.replacement_window_days ?? 7

  const created = new Date(category.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const th = 'px-3 py-2.5 text-left font-medium'
  const statusChip = (active: boolean) => <StatusBadge status={String(active)} map={ACTIVE_STATUS} />

  return (
    <EntityPage
      header={
        <DetailHeader
          back={{ href: ap(backUrl, host), label: 'Categories' }}
          title={category.name}
          status={
            <>
              <StatusBadge status={String(category.is_active)} map={{ true: { label: 'Active', tone: 'green' }, false: { label: 'Inactive', tone: 'red' } }} />
              <Badge tone="blue">{category.parent_category_id ? 'Subcategory' : 'Main'}</Badge>
              {hasDraft && <Badge tone="amber">Draft pending</Badge>}
            </>
          }
          subtitle={category.description || undefined}
          identifiers={[{ label: 'Created', value: created }]}
          actions={
            hasDraft ? (
              <Link
                href={ap(`/admin/categories/${id}/edit?back=${encodeURIComponent(backUrl)}`, host)}
                className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600"
              >
                Edit Draft
              </Link>
            ) : (
              <form action={startCategoryDraft.bind(null, id)}>
                <input type="hidden" name="_back" value={backUrl} />
                <button
                  type="submit"
                  className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600"
                >
                  Edit
                </button>
              </form>
            )
          }
        />
      }
      notices={
        hasDraft && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
            <Info className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-foreground">
              This category has unpublished draft changes. Click <span className="font-semibold">Edit Draft</span> to review and publish them.
            </p>
          </div>
        )
      }
      kpis={
        <KpiGrid>
          <Kpi label="Total products" value={totalProducts.toLocaleString('en-IN')} />
          <Kpi label="Subcategories" value={subcategories.length.toLocaleString('en-IN')} />
          <Kpi label="Display order" value={String(category.display_order)} />
        </KpiGrid>
      }
      main={
        <>
          {subcategories.length > 0 && (
            <Card title="Subcategories" hint={`${subcategories.length}`} flush>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border-default bg-surface-secondary/50 text-xs text-foreground-muted">
                      <th className={`${th} pl-5`}>Name</th>
                      <th className={th}>Slug</th>
                      <th className={th}>Order</th>
                      <th className={`${th} pr-5`}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subcategories.map(s => (
                      <tr key={s.id} className="border-b border-border-default/60 last:border-0 hover:bg-surface-secondary/40">
                        <td className="px-5 py-2.5">
                          <Link href={ap(`/admin/categories/${s.id}`, host)} className="font-medium text-accent-500 hover:underline">
                            {s.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-foreground-muted">{s.slug}</td>
                        <td className="px-3 py-2.5 text-foreground-muted tabular-nums">{s.display_order}</td>
                        <td className="px-5 py-2.5">{statusChip(s.is_active)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card
            title="Products"
            hint={totalProducts > 20 ? `Showing 20 of ${totalProducts}` : `${totalProducts} product${totalProducts !== 1 ? 's' : ''}`}
            flush
          >
            {products.length === 0 ? (
              <EmptyState bare title="No products assigned to this category." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border-default bg-surface-secondary/50 text-xs text-foreground-muted">
                      <th className={`${th} pl-5`}>Product</th>
                      <th className={th}>SKU</th>
                      <th className={`${th} text-right`}>Price</th>
                      <th className={`${th} pr-5`}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map(p => (
                      <tr key={p.id} className="border-b border-border-default/60 last:border-0 hover:bg-surface-secondary/40">
                        <td className="px-5 py-2.5">
                          <Link href={ap(`/admin/products/${p.id}`, host)} className="font-medium text-accent-500 hover:underline">
                            {p.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-foreground-muted">
                          <span className="inline-flex items-center gap-1">
                            {p.sku}
                            {p.sku && <CopySku sku={p.sku} />}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">₹{Number(p.base_price).toLocaleString('en-IN')}</td>
                        <td className="px-5 py-2.5">{statusChip(p.is_active)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      }
      aside={
        <Card title="Category details">
          <Fields cols={1}>
            <Field label="Slug" value={category.slug} mono copy={category.slug} />
            <Field
              label="Parent"
              value={
                parent ? (
                  <Link href={ap(`/admin/categories/${parent.id}`, host)} className="text-accent-500 hover:underline">
                    {parent.name}
                  </Link>
                ) : (
                  '- (top level)'
                )
              }
            />
            <Field label="SKU Prefix" value={category.sku_prefix || null} />
            <Field label="Google Category" value={category.google_product_category || null} />
            <Field label="Icon" value={category.icon_name || null} />
            <Field label="Policy Source" value={isInherited ? <Badge tone="blue">Inherited from {parent?.name ?? 'parent'}</Badge> : 'Overridden'} />
            <Field label="Returns" value={effReturnAllowed ? `${effReturnDays} days` : 'Not allowed'} />
            <Field label="Replacement" value={effReplaceAllowed ? `${effReplaceDays} days` : 'Not allowed'} />
          </Fields>
        </Card>
      }
    />
  )
}
