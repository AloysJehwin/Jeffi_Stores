'use client'

import { useState, type ComponentProps } from 'react'
import OnboardWizard from './OnboardWizard'
import ServicePicker, { type ServiceChoice } from './ServicePicker'
import ServicesOnboard from './ServicesOnboard'
import OnboardShell from './OnboardShell'
import { ENTRY_STEPS } from './steps'

// Step 0 for every new owner: pick services. Store → the full wizard (with extra services carried on
// submit); services only → the short wizard.
export default function OnboardEntry(props: ComponentProps<typeof OnboardWizard>) {
  const [choice, setChoice] = useState<ServiceChoice[] | null>(null)
  if (!choice) {
    return (
      <OnboardShell owner={props.owner} heading="Get started" subheading="Pick what you need." steps={ENTRY_STEPS} current={0} groupTitle="Get started">
        <ServicePicker onContinue={setChoice} />
      </OnboardShell>
    )
  }
  const extras = choice.filter((c): c is 'messaging' | 'documents' => c !== 'store')
  if (choice.includes('store')) return <OnboardWizard {...props} extraServices={extras} />
  return (
    <OnboardShell
      owner={props.owner}
      heading="Your workspace"
      subheading="Live as soon as you submit."
      steps={ENTRY_STEPS}
      current={1}
      groupTitle="Get started"
      onSelect={() => setChoice(null)}
    >
      <ServicesOnboard services={extras} ownerName={props.ownerName ?? null} onBack={() => setChoice(null)} />
    </OnboardShell>
  )
}
