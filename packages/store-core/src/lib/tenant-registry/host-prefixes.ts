// A store's own hosts are <prefix>-{slug}.<root>. Host resolution reads the slug after these, and no slug
// may start with one (public-{slug} carries that store's API tokens). Own module so mocks of ./shared keep it.
export const TENANT_HOST_PREFIXES = ['admin', 'public', 'invoice', 'quotation', 'purchaseorder', 'forms', 'vault', 'www'] as const
// Other products' hosts <prefix>-{slug}.<root>, whose slug is not a store's (site-: Showcase sites, showcase-service).
// Not store hosts, so no store slug may start with one either.
export const PRODUCT_HOST_PREFIXES = ['site'] as const
