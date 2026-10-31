// Pure helpers shared by the sync (server) and the Merchant Sync panel (client).

export interface MerchantSyncError {
  sku: string
  error: string
  // Items affected when one error stands for a whole batch request.
  items?: number
}

export interface MerchantSyncErrorGroup {
  reason: string
  count: number
  skus: string[]
}

export const SYNC_IN_PROGRESS_MESSAGE = 'A Google Merchant sync is already running. Wait for it to finish.'

function normalizeReason(error: string): string {
  return (error || 'Unknown error')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function groupSyncErrors(
  errors: MerchantSyncError[] | null | undefined,
  sampleSize = 50
): MerchantSyncErrorGroup[] {
  const groups = new Map<string, MerchantSyncErrorGroup>()
  for (const e of errors || []) {
    const reason = normalizeReason(e.error)
    const g = groups.get(reason) || { reason, count: 0, skus: [] }
    g.count += e.items && e.items > 0 ? e.items : 1
    if (g.skus.length < sampleSize) g.skus.push(e.sku)
    groups.set(reason, g)
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)
}

export function countSyncErrorItems(errors: MerchantSyncError[] | null | undefined): number {
  return (errors || []).reduce((n, e) => n + (e.items && e.items > 0 ? e.items : 1), 0)
}
