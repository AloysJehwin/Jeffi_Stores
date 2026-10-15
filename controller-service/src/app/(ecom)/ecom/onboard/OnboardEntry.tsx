'use client'

import { useState, type ComponentProps } from 'react'
import OnboardWizard from './OnboardWizard'
import ServicePicker, { type ServiceChoice } from './ServicePicker'
import ServicesOnboard from './ServicesOnboard'

// Step 0 for every new owner: pick services. Store → the full wizard (with extra services carried on
// submit); services only → the short wizard.
export default function OnboardEntry(props: ComponentProps<typeof OnboardWizard>) {
  const [choice, setChoice] = useState<ServiceChoice[] | null>(null)
  if (!choice) {
    return (
      <div className="w-full px-6 lg:px-12 py-16">
        <ServicePicker onContinue={setChoice} />
      </div>
    )
  }
  const extras = choice.filter((c): c is 'messaging' | 'documents' => c !== 'store')
  if (choice.includes('store')) return <OnboardWizard {...props} extraServices={extras} />
  return (
    <div className="w-full px-6 lg:px-12 py-16">
      <ServicesOnboard services={extras} ownerName={props.ownerName ?? null} onBack={() => setChoice(null)} />
    </div>
  )
}
