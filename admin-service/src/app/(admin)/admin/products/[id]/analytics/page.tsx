import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { notFound } from 'next/navigation'
import ProductAnalyticsClient from './ProductAnalyticsClient'
import { PageBody, PageHeader } from '@/components/admin/kit'
import { getProductAnalyticsData } from '@/lib/shared/admin-product-analytics'

export const dynamic = 'force-dynamic'

export default async function ProductAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const host = await getHost()
  const data = await getProductAnalyticsData(id, 30)
  if (!data) notFound()

  return (
    <PageBody>
      <PageHeader
        back={{ href: ap(`/admin/products/${id}`, host), label: data.product.name }}
        title={data.product.name}
        description="Product analytics"
        actions={
          <div className="inline-flex h-control items-center gap-0.5 rounded-lg bg-surface-secondary p-0.5 text-sm">
            <Link href={ap(`/admin/products/${id}`, host)} className="h-full inline-flex items-center rounded-md px-3 font-medium text-foreground-muted hover:text-foreground transition-colors">
              Overview
            </Link>
            <span className="h-full inline-flex items-center rounded-md px-3 font-medium bg-surface-elevated shadow text-foreground">Analytics</span>
          </div>
        }
      />
      <ProductAnalyticsClient productId={id} initial={data} />
    </PageBody>
  )
}
