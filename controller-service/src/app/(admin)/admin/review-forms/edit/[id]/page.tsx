import { permanentRedirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

export const dynamic = 'force-dynamic'

// Old verb-first edit URL; canonical is now /review-forms/<id>/edit.
export default async function ReviewFormEditRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  permanentRedirect(ap(`/admin/review-forms/${id}/edit`, await getHost()))
}
