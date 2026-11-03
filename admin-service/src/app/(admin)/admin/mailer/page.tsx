import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

export default async function MailerRedirect({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const qs = new URLSearchParams(await searchParams).toString()
  redirect(ap(`/admin/marketing/messaging${qs ? `?${qs}` : ''}`, await getHost()))
}
