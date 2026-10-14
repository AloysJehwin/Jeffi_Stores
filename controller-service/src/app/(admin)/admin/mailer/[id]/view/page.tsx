import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

export default async function MailerViewRedirect({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params
  const qs = new URLSearchParams(await searchParams).toString()
  redirect(ap(`/admin/marketing/messaging/${id}/view${qs ? `?${qs}` : ''}`, await getHost()))
}
