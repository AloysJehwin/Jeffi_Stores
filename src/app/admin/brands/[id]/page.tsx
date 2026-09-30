import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'
import DraftEditButton from '@/components/admin/DraftEditButton'
import CopySku from '@/components/ui/CopySku'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { queryOne, queryMany } from '@/lib/shared/db'

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

export default async function BrandViewPage({
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

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={ap(backUrl, host)}
            className="text-foreground-muted hover:text-foreground transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          {brand.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logo_url}
              alt={brand.name}
              className="w-10 h-10 rounded-lg object-contain bg-surface-secondary flex-shrink-0"
            />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground">{brand.name}</h1>
              <span
                className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${brand.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}
              >
                {brand.is_active ? 'Active' : 'Inactive'}
              </span>
              {hasDraft && (
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  Draft pending
                </span>
              )}
            </div>
            {brand.description && <p className="text-sm text-foreground-secondary mt-1">{brand.description}</p>}
            <p className="text-xs text-foreground-muted mt-0.5">
              Created{' '}
              {new Date(brand.created_at).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </p>
          </div>
        </div>
        <DraftEditButton entity="brands" id={id} name={brand.name} hasDraft={!!hasDraft} backUrl={backUrl} />
      </div>

      {hasDraft && (
        <div className="mb-6 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex items-start gap-3">
          <svg
            className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-sm text-amber-800 dark:text-amber-200">
            This brand has unpublished draft changes. Click <span className="font-semibold">Edit Draft</span> to review
            and publish them.
          </p>
        </div>
      )}

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4">
          <p className="text-xs text-foreground-secondary">Total Products</p>
          <p className="text-2xl font-bold text-foreground mt-1">{totalProducts}</p>
        </div>
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4">
          <p className="text-xs text-foreground-secondary">Active Products</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{activeProducts}</p>
        </div>
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4">
          <p className="text-xs text-foreground-secondary">Created</p>
          <p className="text-lg font-bold text-foreground mt-1.5">
            {new Date(brand.created_at).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: details */}
        <div className="space-y-6">
          <div className="bg-surface-elevated rounded-lg border border-border-default overflow-hidden">
            <div className="px-5 py-3 border-b border-border-default bg-surface-secondary">
              <h2 className="text-sm font-semibold text-foreground">Brand Details</h2>
            </div>
            <div className="px-5 divide-y divide-border-default">
              {[
                [
                  'Slug',
                  <span key="slug" className="font-mono">
                    {brand.slug}
                  </span>,
                ],
                [
                  'Website',
                  brand.website ? (
                    <a
                      key="website"
                      href={brand.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-500 hover:underline"
                    >
                      {brand.website.replace(/^https?:\/\//, '')}
                    </a>
                  ) : (
                    '—'
                  ),
                ],
                ['Logo', brand.logo_url ? 'Set' : '—'],
                ['Returns', brand.return_allowed ? `${brand.return_window_days} days` : 'Not allowed'],
                ['Replacement', brand.replacement_allowed ? `${brand.replacement_window_days} days` : 'Not allowed'],
              ].map(([label, value], i) => (
                <div key={i} className="flex items-center justify-between py-2.5 gap-4">
                  <span className="text-sm text-foreground-secondary flex-shrink-0">{label}</span>
                  <span className="text-sm text-foreground font-medium text-right break-all">{value as ReactNode}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: products */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-surface-elevated rounded-lg border border-border-default overflow-hidden">
            <div className="px-5 py-3 border-b border-border-default bg-surface-secondary flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Products</h2>
              <span className="text-xs text-foreground-muted">
                {totalProducts > 20
                  ? `Showing 20 of ${totalProducts}`
                  : `${totalProducts} product${totalProducts !== 1 ? 's' : ''}`}
              </span>
            </div>
            {products.length === 0 ? (
              <p className="px-5 py-6 text-sm text-foreground-muted text-center">No products assigned to this brand.</p>
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
                          <Link
                            href={ap(`/admin/products/${p.id}`, host)}
                            className="font-medium text-accent-500 hover:underline"
                          >
                            {p.name}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-foreground-muted">
                          <span className="inline-flex items-center gap-1">
                            {p.sku}
                            {p.sku && <CopySku sku={p.sku} />}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-semibold text-foreground">
                          ₹{Number(p.base_price).toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-2.5">
                          {p.is_active ? (
                            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                              Active
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-surface-secondary text-foreground-muted">
                              Inactive
                            </span>
                          )}
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
