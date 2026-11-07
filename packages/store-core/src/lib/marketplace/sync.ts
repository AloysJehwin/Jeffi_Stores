import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { errorText, withChannelLock } from '@/lib/channels/sync-run'
import { resolveMarketplaceCreds } from '@/lib/integrations/resolve'
import { marketplaceRules } from './alerts'
import { retryPendingEvents } from './ingest'
import { pollListingTasks } from './listings'
import { getAdapter } from './registry'
import { pushMarketplaceStock } from './stock'
import type { MarketplaceChannel } from './types'

// The {myntra,ajio}-sync cron (every 10 min): retry order events the push didn't finish, poll
// listing submissions, push stock, then run the alert rules.

export async function marketplaceSyncSkip(channel: MarketplaceChannel): Promise<string | null> {
  return (await resolveMarketplaceCreds(channel)) ? null : 'not_connected'
}

export async function runMarketplaceSync(channel: MarketplaceChannel) {
  const creds = await resolveMarketplaceCreds(channel)
  if (!creds) return { skipped: 'not_connected' }
  const adapter = getAdapter(channel, creds)
  const sync = await withChannelLock(channel, channel === 'myntra' ? 'myntra_sync' : 'ajio_sync', 'sync', async ({ step, counts, errors }) => {
    await step('events', async () => {
      const t = await retryPendingEvents(channel, { budgetMs: 60_000 })
      if (t.failed) {
        counts.events_failed = (counts.events_failed ?? 0) + t.failed
        errors.push({ step: 'events', message: `${t.failed} order update(s) failed after every retry` })
      }
      return t.done
    })
    await step('listing_tasks', async () => (await pollListingTasks(channel, adapter)).completed)
  })
  let stock: { status: string; counts: Record<string, number>; errors: number } | { error: string } | null = null
  try {
    const r = await pushMarketplaceStock(channel, { adapter })
    if (r) stock = { status: r.status, counts: r.counts, errors: r.errors.length }
  } catch (e) {
    stock = { error: errorText(e) }
  }
  return { status: sync.status, counts: sync.counts, errors: sync.errors.length, stock, alerts: await runChannelAlerts(marketplaceRules(channel)) }
}
