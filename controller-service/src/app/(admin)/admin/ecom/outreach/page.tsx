import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { PageBody, PageHeader, TabLinks } from '@/components/admin/kit'
import { BASE, TABS, type OutreachTab } from './shared'
import OutreachProgramClient from './OutreachProgramClient'
import OutreachListsClient from './OutreachListsClient'
import OutreachSkillsClient from './OutreachSkillsClient'
import OutreachContactsClient from './OutreachContactsClient'
import OutreachSuppressionsClient from './OutreachSuppressionsClient'

export const dynamic = 'force-dynamic'

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ [k: string]: string | undefined }> }) {
  const h = await headers()
  if (h.get('x-tenant-id')) notFound()
  if (!isPlatformAdmin(h.get('x-user-role') || '')) redirect('/admin')
  const sp = await searchParams
  const tab: OutreachTab = TABS.find(t => t.id === sp.tab)?.id ?? 'program'
  return (
    <PageBody>
      <PageHeader title="Outreach" description="The AI caller phones businesses from imported lists, builds each a Showcase website and sends the links on WhatsApp." />
      <div className="mb-5">
        <TabLinks tabs={TABS.map(t => ({ ...t, href: t.id === 'program' ? BASE : `${BASE}?tab=${t.id}` }))} value={tab} />
      </div>
      {tab === 'program' && <OutreachProgramClient />}
      {tab === 'lists' && <OutreachListsClient />}
      {tab === 'skills' && <OutreachSkillsClient />}
      {tab === 'contacts' && <OutreachContactsClient />}
      {tab === 'suppressions' && <OutreachSuppressionsClient />}
    </PageBody>
  )
}
