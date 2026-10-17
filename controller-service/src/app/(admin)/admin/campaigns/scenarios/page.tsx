import ScenariosListClient from './ScenariosListClient'
import { PageBody, PageHeader } from '@/components/admin/kit'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function ScenariosPage() {
  return (
    <PageBody>
      <PageHeader title="Scenarios" description="Reusable behavioral triggers. Each scenario can power multiple campaigns." />
      <ScenariosListClient />
    </PageBody>
  )
}
