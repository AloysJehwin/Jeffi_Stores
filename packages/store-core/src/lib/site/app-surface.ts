import { getSiteControls } from '@/lib/catalog/site-controls'

/**
 * The store has its own mobile app: the flagship always, a tenant only once its app build ID is set. App layouts and
 * other app-only settings are shown and accepted only then.
 */
export async function storeHasApp(): Promise<boolean> {
  return !!(await getSiteControls().catch(() => null))?.mobileApp.buildId
}

export const NO_APP_ERROR = 'This store has no mobile app, so it has no app layouts or app settings.'
