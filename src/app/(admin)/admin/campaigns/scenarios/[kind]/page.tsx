import ScenarioDetailClient from './ScenarioDetailClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ScenarioDetailPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <ScenarioDetailClient kind={kind} />
    </div>
  )
}
