// Step lists for the onboarding rail. Icons are keys (OnboardShell maps them) so server pages can pass them.
export type StepIconKey =
  | 'plan'
  | 'store'
  | 'business'
  | 'gst'
  | 'warehouse'
  | 'bank'
  | 'branding'
  | 'review'
  | 'payment'
  | 'setup'
  | 'services'
  | 'workspace'

export interface RailStep {
  label: string
  desc?: string
  icon: StepIconKey
}

export const WIZARD_STEPS = [
  { id: 0, label: 'Plan', icon: 'plan', desc: 'Choose your subscription' },
  { id: 1, label: 'Store', icon: 'store', desc: 'Name & subdomain' },
  { id: 2, label: 'Business', icon: 'business', desc: 'Legal details' },
  { id: 3, label: 'GST', icon: 'gst', desc: 'Certificate & number' },
  { id: 4, label: 'Warehouse', icon: 'warehouse', desc: 'Pickup address' },
  { id: 5, label: 'Bank', icon: 'bank', desc: 'Payout account' },
  { id: 6, label: 'Branding', icon: 'branding', desc: 'Logo, seal & consent' },
  { id: 7, label: 'Review', icon: 'review', desc: 'Submit for approval' },
] as const satisfies readonly (RailStep & { id: number })[]

// After submit: the wizard's steps plus checkout (payments on) or the build (payments off).
export const statusSteps = (payments: boolean): RailStep[] => [
  ...WIZARD_STEPS,
  payments
    ? { label: 'Payment', icon: 'payment', desc: 'Complete subscription' }
    : { label: 'Setup', icon: 'setup', desc: 'We build your store' },
]
export const REVIEW_STEP = 7
export const FINAL_STEP = 8

export const ENTRY_STEPS: RailStep[] = [
  { label: 'Services', icon: 'services', desc: 'What you need' },
  { label: 'Details', icon: 'workspace', desc: 'Your business' },
]
