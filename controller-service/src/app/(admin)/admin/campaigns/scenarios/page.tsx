import ScenariosListClient from './ScenariosListClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function ScenariosPage() {
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Scenarios</h1>
        <p className="text-foreground-secondary mt-1 text-sm">
          Reusable behavioral triggers. Each scenario can power multiple campaigns.
        </p>
      </div>
      <ScenariosListClient />
    </div>
  )
}
