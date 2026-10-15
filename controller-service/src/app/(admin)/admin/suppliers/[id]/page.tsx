import { permanentRedirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

export const dynamic = 'force-dynamic'

// Canonical read-only URL is /suppliers/<id>/view; the bare detail URL now redirects there.
export default async function SupplierDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  permanentRedirect(ap(`/admin/suppliers/${id}/view`, await getHost()))
}
