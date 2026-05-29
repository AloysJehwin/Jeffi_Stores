import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import ProductAnalyticsClient from './ProductAnalyticsClient'

export const dynamic = 'force-dynamic'

export default async function ProductAnalyticsPage({ params }: { params: { id: string } }) {
  const cookieStore = cookies()
  const cookie = cookieStore.toString()

  const res = await fetch(`http://localhost:3000/api/admin/products/${params.id}/analytics?days=30`, {
    headers: { cookie },
    cache: 'no-store',
  })
  if (!res.ok) notFound()
  const data = await res.json()

  return (
    <div className="p-4 sm:p-6 max-w-full space-y-5">
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <Link href="/admin/products" className="text-accent-500 hover:text-accent-600 transition-colors">Products</Link>
        <span>/</span>
        <Link href={`/admin/products/${params.id}`} className="text-accent-500 hover:text-accent-600 transition-colors truncate">{data.product.name}</Link>
        <span>/</span>
        <span className="text-foreground">Analytics</span>
      </div>
      <ProductAnalyticsClient productId={params.id} initial={data} />
    </div>
  )
}
