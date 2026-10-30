import 'server-only'
import { queryOne } from '@/lib/shared/db'
import { buildOrderDocuments, missingDocScope, MAX_DOCUMENT_ORDERS, NothingToDownload, type OrderDoc } from '@/lib/documents/order-documents'
import { attachmentAvailable, type OpsEmailConfig } from '@/lib/shared/ops-email-config'

// The daily email's attachments: one PDF of the chosen documents for the orders waiting to ship. Invoices
// are read as an admin: whoever last saved the settings while still active, else the oldest owner.

const BUILD_BUDGET_MS = 120_000

export interface OpsAttachments {
  attachments: Array<{ filename: string; content: Buffer; contentType: string }>
  /** What was attached, or why nothing was. Empty when no attachment is set up. */
  note: string
}

export function wantedDocs(cfg: OpsEmailConfig, planHas: (scope: string) => boolean): OrderDoc[] {
  const a = cfg.attachments
  return [
    a.invoices && attachmentAvailable('invoices', planHas) ? ('invoice' as const) : null,
    a.slips && attachmentAvailable('slips', planHas) ? ('packing_slip' as const) : null,
    a.labels && attachmentAvailable('labels', planHas) ? ('label' as const) : null,
  ].filter((d): d is OrderDoc => !!d)
}

export async function buildOpsAttachments(
  cfg: OpsEmailConfig,
  orderIds: string[],
  planHas: (scope: string) => boolean,
  packingSlipsUrl: string
): Promise<OpsAttachments> {
  const wanted = wantedDocs(cfg, planHas)
  if (!wanted.length) return { attachments: [], note: '' }
  if (!orderIds.length) return { attachments: [], note: 'No orders waiting to ship, so nothing is attached.' }

  const actor = await queryOne<{ id: string; role: string; scopes: string[] | null }>(
    `SELECT id::text, role, scopes FROM admins
      WHERE is_active = TRUE AND (id = $1::uuid OR role IN ('super_admin', 'administrator'))
      ORDER BY (id = $1::uuid) DESC NULLS LAST, created_at ASC LIMIT 1`,
    [cfg.updatedBy ?? null]
  )
  if (!actor) return { attachments: [], note: '' }
  const admin = { adminId: actor.id, role: actor.role, scopes: (actor.scopes ?? []).filter(planHas) }
  const docs = wanted.filter(d => !missingDocScope(admin, [d]))
  if (!docs.length) return { attachments: [], note: '' }

  const ids = orderIds.slice(0, MAX_DOCUMENT_ORDERS)
  const fallback = `Download them from Packing slips: ${packingSlipsUrl}`
  try {
    const built = await Promise.race([
      buildOrderDocuments({ orderIds: ids, docs, labelSize: cfg.attachments.labelSize, admin }),
      new Promise<'timeout'>(r => setTimeout(() => r('timeout'), BUILD_BUDGET_MS).unref?.()),
    ])
    if (built === 'timeout') return { attachments: [], note: `The documents took too long to build. ${fallback}` }
    if (!built) return { attachments: [], note: '' }
    if (built.pdf.length > cfg.attachments.maxMb * 1024 * 1024)
      return { attachments: [], note: `The documents for ${built.orderNumbers.length} orders are over ${cfg.attachments.maxMb} MB. ${fallback}` }
    const skipped = Object.values(built.skipped).flat().length
    return {
      attachments: [{ filename: `orders-to-ship-${new Date().toISOString().slice(0, 10)}.pdf`, content: Buffer.from(built.pdf), contentType: 'application/pdf' }],
      note: `Attached: documents for ${built.orderNumbers.length} order${built.orderNumbers.length === 1 ? '' : 's'} waiting to ship${skipped ? ` (${skipped} not ready yet, such as labels before the shipment is booked)` : ''}.`,
    }
  } catch (err) {
    if (err instanceof NothingToDownload) return { attachments: [], note: 'None of the waiting orders has these documents yet.' }
    console.error('[ops-email] attachments', err)
    return { attachments: [], note: `The documents could not be built. ${fallback}` }
  }
}
