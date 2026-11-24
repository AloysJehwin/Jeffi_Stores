import type { ServiceState } from './service-states'

// Words the owner console repeats, from one place so every page says the same thing.

/** How long Jeffi's review takes: the KYC flow's promise (onboarding and the application email). No SLA enforces it. */
export const REVIEW_TIME = '1–2 business days'

export const SERVICE_NAME: Record<string, string> = { store: 'Store', messaging: 'Messaging', documents: 'Documents', showcase: 'Showcase' }

/** Where a Messaging or Documents service stands, as the console says it. */
export const STATUS_LABEL: Record<ServiceState['status'], string> = { live: 'Live', pending: 'Awaiting approval', rejected: 'Not approved', off: 'Not added' }

/** A workspace's services in nav order, as the workspace switcher shows them: "Store + Messaging". */
export const workspaceLabel = (types: string[]) =>
  Object.keys(SERVICE_NAME)
    .filter(s => types.includes(s))
    .map(s => SERVICE_NAME[s])
    .join(' + ')
