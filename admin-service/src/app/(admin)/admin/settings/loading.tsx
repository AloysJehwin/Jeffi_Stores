import { LoadingFacts, LoadingLines, LoadingSection, LoadingTabs, PageLoading } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading title="Settings" description="Your account, team, service accounts, CLI tokens and the audit log">
      <LoadingTabs tabs={['Account', 'Team', 'Service accounts', 'CLI & tokens', 'Audit log']} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LoadingSection title="Account">
          <LoadingFacts labels={['Name', 'Email', 'Role', 'Joined', 'Last Login']} />
        </LoadingSection>
        <LoadingSection title="Two-Factor Authentication" lines={3} />
        <LoadingSection title="Mobile number" lines={2} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LoadingSection title="Chrome Extension Token" lines={3} />
      </div>
      <LoadingSection title="System">
        <LoadingLines lines={1} />
      </LoadingSection>
    </PageLoading>
  )
}
