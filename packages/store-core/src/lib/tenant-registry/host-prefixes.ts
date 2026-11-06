// A store's own hosts are <prefix>-{slug}.<root>. Host resolution reads the slug after these, and no slug
// may start with one (public-{slug} carries that store's API tokens). Own module so mocks of ./shared keep it.
export const TENANT_HOST_PREFIXES = ['admin', 'public', 'invoice', 'quotation', 'purchaseorder', 'forms', 'vault', 'www'] as const
