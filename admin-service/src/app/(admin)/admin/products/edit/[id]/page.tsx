import { permanentRedirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

export const dynamic = 'force-dynamic'

// Old verb-first edit URL; canonical is now /products/<id>/edit.
export default async function ProductEditRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  permanentRedirect(ap(`/admin/products/${id}/edit`, await getHost()))
}
