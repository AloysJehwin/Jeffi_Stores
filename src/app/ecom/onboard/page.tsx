import { listPlans } from '@/lib/tenant-registry'
import OnboardWizard from './OnboardWizard'

export const dynamic = 'force-dynamic'

export default async function OnboardPage() {
  const plans = await listPlans()
  return (
    <div className="py-12 px-4 sm:px-8">
      <header className="text-center mb-10">
        <h1 className="text-3xl font-bold text-foreground">Launch your store</h1>
        <p className="text-foreground-muted mt-2">A few steps and you&apos;re live on your own subdomain.</p>
      </header>
      <OnboardWizard plans={plans} />
    </div>
  )
}
