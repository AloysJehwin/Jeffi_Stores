import { permanentRedirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

export const dynamic = 'force-dynamic'

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const q = await searchParams
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (typeof v === 'string') sp.set(k, v)
  const qs = sp.toString()
  permanentRedirect(ap(`/admin/orders/${id}/view${qs ? `?${qs}` : ''}`, await getHost()))
}
