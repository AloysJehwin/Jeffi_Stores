import { ROOT_DOMAIN } from '@/lib/tenant-registry/shared'

// Internal owner accounts the platform holds things with (the outreach program's sites until claimed). Nobody signs
// in as one: issueOwnerSession refuses their addresses.

export const outreachSystemEmail = () => `outreach-system@${ROOT_DOMAIN}`

export const isSystemOwnerEmail = (email: string | null | undefined) => (email ?? '').trim().toLowerCase() === outreachSystemEmail().toLowerCase()
