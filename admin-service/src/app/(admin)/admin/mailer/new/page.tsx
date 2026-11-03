import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

export default async function MailerNewRedirect({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const qs = new URLSearchParams(await searchParams).toString()
  redirect(ap(`/admin/marketing/messaging/new${qs ? `?${qs}` : ''}`, await getHost()))
}
