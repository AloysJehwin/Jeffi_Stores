import NewScenarioClient from './NewScenarioClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function NewScenarioPage() {
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <NewScenarioClient />
    </div>
  )
}
