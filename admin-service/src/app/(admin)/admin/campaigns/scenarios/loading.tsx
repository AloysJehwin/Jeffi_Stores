import { ScenarioCrumbLoading } from './_components/ScenarioLoading'

// Neutral: this boundary also shows on the way to a scenario or a new one (the list itself is a campaigns tab).
export default function Loading() {
  return (
    <div className="p-4 sm:p-6" role="status" aria-busy="true" aria-label="Loading">
      <ScenarioCrumbLoading />
    </div>
  )
}
