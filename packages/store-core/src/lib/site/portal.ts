/** The storefront or the business portal: each app bakes its own name in (next.config `JEFFI_APP`). Client-safe. */
export const portalHere = (): 'storefront' | 'business' => (process.env.JEFFI_APP === 'business' ? 'business' : 'storefront')

/**
 * Drawn by the studio's preview: its sample catalogue, or any page the control plane's app draws (the preview over the
 * store's own catalogue too). There is no cart, account or store API behind it, so the parts that act draw inert.
 */
export const studioPreview = (data: { sample?: boolean }) => !!data.sample || process.env.JEFFI_APP === 'controller'
