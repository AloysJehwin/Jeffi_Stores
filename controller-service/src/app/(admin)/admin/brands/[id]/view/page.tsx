import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Info } from 'lucide-react'
import DraftEditButton from '@/components/admin/DraftEditButton'
import CopySku from '@/components/ui/CopySku'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { queryOne, queryMany } from '@/lib/shared/db'
import { Card, DetailHeader, EntityPage, Field, Fields, Kpi, KpiGrid, StatusBadge, ACTIVE_STATUS, EmptyState, Badge } from '@/components/admin/kit'

export const dynamic = 'force-dynamic'

interface Brand {
  id: string
  name: string
  slug: string
  logo_url: string | null
  description: string | null
  website: string | null
  is_active: boolean
  created_at: string
  return_allowed: boolean
  return_window_days: number
  replacement_allowed: boolean
  replacement_window_days: number
}

interface ProductRow {
  id: string
  name: string
  sku: string
  is_active: boolean
  base_price: number
}

export default async function BrandViewPageDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ back?: string }>
}) {
  const { id } = await params
  const { back } = await searchParams
  const host = await getHost()
  const backUrl = back && back.startsWith('/admin/brands') ? back : '/admin/brands'

  const brand = await queryOne<Brand>('SELECT * FROM brands WHERE id = $1', [id])
  if (!brand) notFound()

  const [hasDraft, products, counts] = await Promise.all([
    queryOne<{ brand_id: string }>('SELECT brand_id FROM brand_drafts WHERE brand_id = $1', [id]),
    queryMany<ProductRow>(
      'SELECT id, name, sku, is_active, base_price FROM products WHERE brand_id = $1 ORDER BY name LIMIT 20',
      [id]
    ),
    queryOne<{ total: string; active: string }>(
      `SELECT COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE is_active)::text AS active
       FROM products WHERE brand_id = $1`,
      [id]
    ),
  ])

  const totalProducts = parseInt(counts?.total || '0', 10)
  const activeProducts = parseInt(counts?.active || '0', 10)
  const created = new Date(brand.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <EntityPage
      header={
        <DetailHeader
          back={{ href: ap(backUrl, host), label: 'Brands' }}
          media={
            brand.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo_url} alt={brand.name} className="w-10 h-10 rounded-lg object-contain bg-surface-secondary flex-shrink-0" />
            ) : undefined
          }
          title={brand.name}
          status={
            <>
              <StatusBadge status={String(brand.is_active)} map={ACTIVE_STATUS} />
              {hasDraft && <Badge tone="amber">Draft pending</Badge>}
            </>
          }
          subtitle={brand.description || undefined}
          identifiers={[{ label: 'Created', value: created }]}
          actions={
            <DraftEditButton
              entity="brands"
              id={id}
              name={brand.name}
              hasDraft={!!hasDraft}
              backUrl={backUrl}
              className="control-md bg-accent-500 hover:bg-accent-600 text-white font-semibold"
            />
          }
        />
      }
      notices={
        hasDraft && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
            <Info className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-foreground">
              This brand has unpublished draft changes. Click <span className="font-semibold">Edit Draft</span> to review and publish them.
            </p>
          </div>
        )
      }
      kpis={
        <KpiGrid>
          <Kpi label="Total products" value={totalProducts.toLocaleString('en-IN')} />
          <Kpi label="Active products" value={activeProducts.toLocaleString('en-IN')} />
          <Kpi label="Created" value={created} />
        </KpiGrid>
      }
      main={
        <Card
          title="Products"
          hint={totalProducts > 20 ? `Showing 20 of ${totalProducts}` : `${totalProducts} product${totalProducts !== 1 ? 's' : ''}`}
          flush
        >
          {products.length === 0 ? (
            <EmptyState bare title="No products assigned to this brand." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border-default bg-surface-secondary/50 text-xs text-foreground-muted">
                    <th className="px-5 py-2.5 text-left font-medium">Product</th>
                    <th className="px-3 py-2.5 text-left font-medium">SKU</th>
                    <th className="px-3 py-2.5 text-right font-medium">Price</th>
                    <th className="px-5 py-2.5 text-left font-medium">Status</th>
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
                      <td className="px-5 py-2.5">
                        <StatusBadge status={String(p.is_active)} map={ACTIVE_STATUS} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      }
      aside={
        <Card title="Brand details">
          <Fields cols={1}>
            <Field label="Slug" value={brand.slug} mono copy={brand.slug} />
            <Field
              label="Website"
              value={
                brand.website ? (
                  <a href={brand.website} target="_blank" rel="noopener noreferrer" className="text-accent-500 hover:underline break-all">
                    {brand.website.replace(/^https?:\/\//, '')}
                  </a>
                ) : null
              }
            />
            <Field label="Logo" value={brand.logo_url ? 'Set' : null} />
            <Field label="Returns" value={brand.return_allowed ? `${brand.return_window_days} days` : 'Not allowed'} />
            <Field label="Replacement" value={brand.replacement_allowed ? `${brand.replacement_window_days} days` : 'Not allowed'} />
          </Fields>
        </Card>
      }
    />
  )
}
