import ScenarioDetailClient from './ScenarioDetailClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function ScenarioDetailPage({ params }: { params: { kind: string } }) {
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <ScenarioDetailClient kind={params.kind} />
    </div>
  )
}
