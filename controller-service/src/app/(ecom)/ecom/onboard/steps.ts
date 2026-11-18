// Step lists for the onboarding rail. Icons are keys (OnboardShell maps them) so server pages can pass them.
export type StepIconKey =
  | 'plan'
  | 'store'
  | 'business'
  | 'gst'
  | 'warehouse'
  | 'bank'
  | 'branding'
  | 'site'
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

export type WizardStepKey = 'plan' | 'store' | 'site' | 'business' | 'gst' | 'warehouse' | 'bank' | 'branding' | 'review'

// The wizard, in order (id = position). A draft saves the step's key (data.stepId); current_step keeps the position.
export const WIZARD_STEPS = [
  { id: 0, key: 'plan', label: 'Plan', icon: 'plan', desc: 'Choose your subscription' },
  { id: 1, key: 'store', label: 'Store', icon: 'store', desc: 'Details, licences & contact' },
  { id: 2, key: 'site', label: 'Your site', icon: 'site', desc: 'Designed live by AI' },
  { id: 3, key: 'business', label: 'Business', icon: 'business', desc: 'Legal details' },
  { id: 4, key: 'gst', label: 'GST', icon: 'gst', desc: 'GSTIN' },
  { id: 5, key: 'warehouse', label: 'Warehouse', icon: 'warehouse', desc: 'Pickup address' },
  { id: 6, key: 'bank', label: 'Bank', icon: 'bank', desc: 'Payout account' },
  { id: 7, key: 'branding', label: 'Branding', icon: 'branding', desc: 'Owner, seal & consent' },
  { id: 8, key: 'review', label: 'Review', icon: 'review', desc: 'Submit for approval' },
] as const satisfies readonly (RailStep & { id: number; key: WizardStepKey })[]

export const stepIndex = (key: WizardStepKey): number => WIZARD_STEPS.findIndex(s => s.key === key)

// Drafts saved before steps had keys hold only their position in this order (Your site came after Branding).
const LEGACY_ORDER: WizardStepKey[] = ['plan', 'store', 'business', 'gst', 'warehouse', 'bank', 'branding', 'site', 'review']

/** Where a saved draft resumes: its step key, else what its position meant in the old order. */
export function resumeStep(currentStep: unknown, stepId: unknown): number {
  const byKey = WIZARD_STEPS.findIndex(s => s.key === stepId)
  if (byKey >= 0) return byKey
  const legacy = LEGACY_ORDER[Number(currentStep) || 0]
  return legacy ? stepIndex(legacy) : 0
}

// After submit: the wizard's steps plus checkout (payments on) or the build (payments off).
export const statusSteps = (payments: boolean): RailStep[] => [
  ...WIZARD_STEPS,
  payments
    ? { label: 'Payment', icon: 'payment', desc: 'Complete subscription' }
    : { label: 'Setup', icon: 'setup', desc: 'We build your store' },
]
export const REVIEW_STEP = WIZARD_STEPS.length - 1
export const FINAL_STEP = WIZARD_STEPS.length

export const ENTRY_STEPS: RailStep[] = [
  { label: 'Services', icon: 'services', desc: 'What you need' },
  { label: 'Details', icon: 'workspace', desc: 'Your business' },
]
