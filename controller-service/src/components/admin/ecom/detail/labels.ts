/** "Messaging + Documents" for a workspace's API services. */
export const apiServices = (t: { service_types?: string[] | null }) =>
  (t.service_types ?? []).filter(s => s !== 'store').map(s => (s === 'messaging' ? 'Messaging' : 'Documents')).join(' + ') || 'no services'

export type DetailSection = 'store' | 'instance' | 'status' | 'billing'

/** The four detail pages, each under its own list's path so the sidebar keeps that group open. */
export const detailHref = (id: string, s: DetailSection) =>
  s === 'store'
    ? `/admin/ecom/customers/${id}/view?tab=overview`
    : s === 'instance'
      ? `/admin/ecom/instances/${id}/view`
      : s === 'status'
        ? `/admin/ecom/store-status/${id}/view`
        : `/admin/ecom/billing/${id}/view`
