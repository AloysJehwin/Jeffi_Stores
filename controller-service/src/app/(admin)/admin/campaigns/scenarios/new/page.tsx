import NewScenarioClient from './NewScenarioClient'
import MobileEditBlock from '@/components/admin/MobileEditBlock'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function NewScenarioPage() {
  return (
    <MobileEditBlock>
    <div className="p-4 sm:p-6 space-y-5">
      <NewScenarioClient />
    </div>
    </MobileEditBlock>
  )
}
