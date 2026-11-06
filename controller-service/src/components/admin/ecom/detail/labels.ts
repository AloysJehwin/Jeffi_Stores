/** "Messaging + Documents" for a workspace's API services. */
export const apiServices = (t: { service_types?: string[] | null }) =>
  (t.service_types ?? []).filter(s => s !== 'store').map(s => (s === 'messaging' ? 'Messaging' : 'Documents')).join(' + ') || 'no services'

export type DetailSection = 'store' | 'instance' | 'status' | 'billing'
