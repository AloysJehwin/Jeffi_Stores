'use client'

import { useState, type ComponentProps } from 'react'
import { useRouter } from 'next/navigation'
import OnboardWizard from './OnboardWizard'
import ServicePicker, { type ServiceChoice } from './ServicePicker'
import ServicesOnboard from './ServicesOnboard'
import OnboardShell from './OnboardShell'
import { ENTRY_STEPS } from './steps'

// Step 0 for every new owner: pick services. Store → the full wizard (with extra services carried on
// submit); services only → the short wizard; Showcase → its own signup.
export default function OnboardEntry(props: ComponentProps<typeof OnboardWizard>) {
  const router = useRouter()
  const [choice, setChoice] = useState<ServiceChoice[] | null>(null)
  if (!choice) {
    return (
      <OnboardShell owner={props.owner} heading="Get started" subheading="Pick what you need." steps={ENTRY_STEPS} current={0} groupTitle="Get started">
        <ServicePicker onContinue={c => (c.includes('showcase') ? router.push('/onboard/showcase') : setChoice(c))} />
      </OnboardShell>
    )
  }
  const extras = choice.filter((c): c is 'messaging' | 'documents' => c === 'messaging' || c === 'documents')
  if (choice.includes('store')) return <OnboardWizard {...props} extraServices={extras} />
  return (
    <OnboardShell
      owner={props.owner}
      heading="Your workspace"
      subheading="Ready to explore as soon as you submit."
      steps={ENTRY_STEPS}
      current={1}
      groupTitle="Get started"
      onSelect={() => setChoice(null)}
    >
      <ServicesOnboard services={extras} ownerName={props.ownerName ?? null} onBack={() => setChoice(null)} />
    </OnboardShell>
  )
}
