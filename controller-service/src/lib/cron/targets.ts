import type { StoreLayout } from '@/lib/compute/spec'
import { CRON_PING_PATH } from '@/lib/shared/cron-jobs'

// Where the cron fan-out and provisioning's connect_crons step reach a store, in one place so they can't
// drift. In the cluster the flagship's admin is CRON_FLAGSHIP_BASE and a store's is CRON_STORE_BASE
// ({slug} and {service} filled in); locally every base is the dev router on :3000, which routes by host
// and path like the ingress does.

export const cronRootDomain = () => process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'
export const cronSelfBase = () => process.env.CRON_SELF_BASE || 'http://127.0.0.1:3000'
export const cronFlagshipBase = () => process.env.CRON_FLAGSHIP_BASE || cronSelfBase()
export const flagshipCronHost = () => cronRootDomain()
export const storeCronHost = (slug: string) => `${slug}.${cronRootDomain()}`

export const OLD_LAYOUT_SKIP = 'old all-in-one layout'

/**
 * What the old all-in-one app (a pre-split image a store keeps until it moves to its own services) answers
 * to a cron bearer: its store crons and the Delhivery sync. Its middleware refuses the bearer on every other
 * admin API route (the feed syncs), and it predates the ping route.
 */
export const servedByOldApp = (path: string) =>
  (path.startsWith('/api/cron/') && path !== CRON_PING_PATH) || path === '/api/admin/delhivery/sync-statuses'

export type StoreCronTarget = { base: string } | { skip: string }

/** A store's cron base for `path`: its own admin service, or the old app ({service} placeholder only). */
export function storeCronTarget(slug: string, layout: StoreLayout, path: string): StoreCronTarget {
  const tpl = process.env.CRON_STORE_BASE
  if (!tpl) return { base: cronFlagshipBase() }
  const fill = (service: string) => tpl.replaceAll('{slug}', slug).replaceAll('{service}', service)
  if (layout !== 'controller') return { base: fill('admin-service') }
  if (!tpl.includes('{service}') || !servedByOldApp(path)) return { skip: OLD_LAYOUT_SKIP }
  return { base: fill('controller-service') }
}
