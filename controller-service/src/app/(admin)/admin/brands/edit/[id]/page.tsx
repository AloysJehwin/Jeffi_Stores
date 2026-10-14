import { permanentRedirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

export const dynamic = 'force-dynamic'

export default async function BrandEditRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = new URLSearchParams()
  const q = await searchParams
  if (typeof q.back === 'string') sp.set('back', q.back)
  const qs = sp.toString()
  permanentRedirect(ap(`/admin/brands/${id}/edit${qs ? `?${qs}` : ''}`, await getHost()))
}
