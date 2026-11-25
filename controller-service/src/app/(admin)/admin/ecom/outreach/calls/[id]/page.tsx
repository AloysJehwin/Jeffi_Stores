import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { BackLink, PageBody } from '@/components/admin/kit'
import { BASE } from '../../shared'
import CallPanelClient from '../../CallPanelClient'

export const dynamic = 'force-dynamic'

export default async function OutreachCallPage({ params }: { params: Promise<{ id: string }> }) {
  const h = await headers()
  if (h.get('x-tenant-id')) notFound()
  if (!isPlatformAdmin(h.get('x-user-role') || '')) redirect('/admin')
  const { id } = await params
  return (
    <PageBody>
      <BackLink href={BASE} label="Outreach" />
      <CallPanelClient callId={id} defaultOpen />
    </PageBody>
  )
}
