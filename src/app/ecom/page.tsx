import { listPlans } from '@/lib/tenant-registry'
import OnboardForm from './OnboardForm'

export const dynamic = 'force-dynamic'

export default async function EcomOnboardingPage() {
  const plans = await listPlans()
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-8">
      <div className="w-full max-w-5xl mx-auto">
        <header className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Launch your store on Jeffi</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2">
            Pick a plan, name your store, and go live on your own subdomain.
          </p>
        </header>
        <OnboardForm plans={plans} />
      </div>
    </div>
  )
}
