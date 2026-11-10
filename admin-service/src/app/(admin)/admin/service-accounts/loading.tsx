import { LoadingKpis, LoadingSection, LoadingTable, LoadingTabs, PageLoading } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading title="Settings" description="Your account, team, service accounts, CLI tokens and the audit log">
      <LoadingTabs tabs={['Account', 'Team', 'Service accounts', 'CLI & tokens', 'Audit log']} active={2} />
      <LoadingKpis labels={['Total', 'Active', 'Revoked', 'Never Used']} />
      <LoadingSection title="All Accounts">
        <LoadingTable bare rows={4} columns={['Account', 'Cert CN', 'Scopes', 'Status', 'Created', 'Last Used']} />
      </LoadingSection>
      <LoadingSection title="Scope Roles" lines={4} />
    </PageLoading>
  )
}
