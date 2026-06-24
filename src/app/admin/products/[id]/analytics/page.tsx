import Link from 'next/link'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { notFound } from 'next/navigation'
import ProductAnalyticsClient from './ProductAnalyticsClient'
import { getProductAnalyticsData } from '@/lib/admin-product-analytics'

export const dynamic = 'force-dynamic'

export default async function ProductAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const host = await getHost()
  const data = await getProductAnalyticsData(id, 30)
  if (!data) notFound()

  return (
    <div className="p-4 sm:p-6 max-w-full space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-foreground-secondary">
          <Link href={ap('/admin/products', host)} className="text-accent-500 hover:text-accent-600 transition-colors">Products</Link>
          <span>/</span>
          <Link href={ap(`/admin/products/${id}`, host)} className="text-accent-500 hover:text-accent-600 transition-colors truncate max-w-[200px]">{data.product.name}</Link>
          <span>/</span>
          <span className="text-foreground">Analytics</span>
        </div>
        <div className="flex items-center gap-1 bg-surface-secondary rounded-lg p-0.5 text-sm">
          <Link
            href={ap(`/admin/products/${id}`, host)}
            className="px-3 py-1.5 rounded-md font-medium text-foreground-muted hover:text-foreground transition-colors"
          >
            Overview
          </Link>
          <span className="px-3 py-1.5 rounded-md font-medium bg-surface-elevated shadow text-foreground">
            Analytics
          </span>
        </div>
      </div>
      <ProductAnalyticsClient productId={id} initial={data} />
    </div>
  )
}
