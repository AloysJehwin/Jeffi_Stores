import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { PageBody, PageHeader } from '@/components/admin/kit/layout'
import DomainsClient from './DomainsClient'

export const dynamic = 'force-dynamic'

export default async function DomainsPage() {
  const h = await headers()
  if (h.get('x-tenant-id')) notFound()
  if (!isPlatformAdmin(h.get('x-user-role') || '')) redirect('/admin')
  return (
    <PageBody>
      <PageHeader title="Domains" description="Domains stores bought through the platform: status, expiry and renewal, what AWS charges against what the store paid, and the margin." />
      <DomainsClient />
    </PageBody>
  )
}
