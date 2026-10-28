import NewScenarioClient from './NewScenarioClient'
import MobileEditBlock from '@/components/admin/MobileEditBlock'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function NewScenarioPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const { draft } = await searchParams
  const draftId = draft && /^[0-9a-f-]{36}$/i.test(draft) ? draft : null
  return (
    <MobileEditBlock>
    <div className="p-4 sm:p-6 space-y-5">
      <NewScenarioClient initialDraftId={draftId} />
    </div>
    </MobileEditBlock>
  )
}
