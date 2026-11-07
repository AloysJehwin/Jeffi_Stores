import { queryOne } from '@/lib/shared/db'
import { CHANNEL_LABEL, isMarketplaceChannel } from './types'

// Myntra and AJIO orders are fulfilled on their console: the marketplace's courier ships them, so
// the Orders page must not mark them shipped by hand, change their status (stock is already moved
// by the marketplace events) or book them with Delhivery.

export type RefusalKind = 'status' | 'delhivery' | 'return_pickup'

/** The 409 message for a marketplace order, or null when the order is not one. */
export function marketplaceRefusal(source: string | null | undefined, kind: RefusalKind): string | null {
  if (!isMarketplaceChannel(source)) return null
  const name = CHANNEL_LABEL[source]
  if (kind === 'delhivery') return `This is a ${name} order: ${name}'s courier ships it, so it can't be sent to Delhivery. Download its label from the ${name} page.`
  if (kind === 'return_pickup') return `${name} collects returns for this order. Record the return on the ${name} page's Returns tab.`
  return `This is a ${name} order: its status comes from ${name}. Accept and dispatch it on the ${name} page; ${name}'s courier ships it.`
}

export async function marketplaceRefusalFor(orderId: string, kind: RefusalKind): Promise<string | null> {
  const row = await queryOne<{ source: string | null }>(`SELECT source FROM orders WHERE id = $1`, [orderId]).catch(() => null)
  return marketplaceRefusal(row?.source, kind)
}
