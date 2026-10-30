// Pure helpers shared by the Amazon sync (server) and the Amazon panel (client).
import { groupSyncErrors, type MerchantSyncError, type MerchantSyncErrorGroup } from '@/lib/merchant/sync-errors'

export const AMAZON_SYNC_IN_PROGRESS_MESSAGE = 'An Amazon sync is already running. Wait for it to finish.'

// SP-API failures read "Amazon PUT /listings/.../<sku>?... failed (400): {json}"; the path carries
// the SKU, so reduce them to the status and Amazon's own messages so errors group by reason.
export function amazonErrorReason(message: string): string {
  const m = /^Amazon [A-Z]+ \S+ failed \((\d{3})\):\s*([\s\S]*)$/.exec(message || '')
  if (!m) return message || 'Unknown error'
  const [, status, body] = m
  let detail = body.trim()
  try {
    const parsed = JSON.parse(body)
    const msgs = (parsed?.errors || [])
      .map((e: any) => [e?.code, e?.message].filter(Boolean).join(': '))
      .filter(Boolean)
    if (msgs.length) detail = [...new Set(msgs)].join('; ')
  } catch {}
  return `Amazon rejected the request (${status})${detail ? `: ${detail.slice(0, 300)}` : ''}`
}

export function groupAmazonSyncErrors(
  errors: MerchantSyncError[] | null | undefined,
  sampleSize?: number
): MerchantSyncErrorGroup[] {
  return groupSyncErrors(
    (errors || []).map(e => ({ ...e, error: amazonErrorReason(e.error) })),
    sampleSize
  )
}
