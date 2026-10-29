import 'server-only'
import { z } from 'zod'
import { queryMany, queryOne } from '@/lib/shared/db'
import type { Scenario } from '../types'

// A finalised quotation we sent: the customer accepts it, turns it down, or asks for changes. The
// answer is recorded on the quotation (customer_response); converting it stays an admin step.

interface Snap {
  id: string
  number: string
  total: number
  lines: string[]
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function respond(id: string, response: 'accepted' | 'rejected'): Promise<boolean> {
  const r = await queryOne(
    `UPDATE quotations SET customer_response = $2, customer_response_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'final' AND converted_order_id IS NULL AND customer_response IS NULL RETURNING id`,
    [id, response]
  )
  return !!r
}

export const quotation: Scenario<Snap> = {
  key: 'quotation',
  label: 'Quotation',
  scope: 'quotations:write',
  href: ctx => `/admin/quotations/${ctx.entity_id}/view`,

  async snapshot(ctx) {
    const q = await queryOne<any>(
      `SELECT id, quote_number, total_amount FROM quotations
        WHERE id = $1 AND status = 'final' AND converted_order_id IS NULL AND customer_response IS NULL`,
      [ctx.entity_id]
    ).catch(() => null)
    if (!q) return null
    const items = await queryMany<any>(
      `SELECT description, quantity, unit, rate FROM quotation_items WHERE quotation_id = $1 ORDER BY position LIMIT 12`,
      [q.id]
    ).catch(() => [])
    return {
      id: q.id,
      number: q.quote_number,
      total: Number(q.total_amount),
      lines: items.map(i => `${i.description} × ${Number(i.quantity)}${i.unit ? ` ${i.unit}` : ''} @ ${rupees(Number(i.rate))}`),
    }
  },

  describe: s =>
    `We sent the customer quotation ${s.number} for ${rupees(s.total)}: ${s.lines.join('; ')}.`,

  yes: 'accept',
  no: 'reject',
  intents: {
    accept: { describe: 'They accept the quotation and want to go ahead with the order as quoted.', tier: 'auto', title: s => `Accept quotation ${s.number} (${rupees(s.total)})` },
    reject: { describe: 'They are not going ahead with this quotation.', tier: 'auto', title: s => `Decline quotation ${s.number}` },
    request_changes: {
      describe: 'They want something changed before accepting: price, quantities, items, delivery or payment terms.',
      tier: 'admin',
      manual: true,
      args: z.object({ request: z.string().max(500) }),
      title: (s, a) => `Customer wants changes to quotation ${s.number}: ${a?.request ?? ''}`,
    },
  },

  async execute(intent, _args, s) {
    if (intent === 'accept') {
      if (!(await respond(s.id, 'accepted'))) return { ok: false, text: 'This quotation can no longer be accepted.' }
      return { ok: true, close: true, text: `Thank you! We've noted that you accept quotation ${s.number}. Our team will send you the invoice and next steps shortly.` }
    }
    if (intent === 'reject') {
      if (!(await respond(s.id, 'rejected'))) return { ok: false, text: 'This quotation is already settled.' }
      return { ok: true, close: true, text: `Thanks for letting us know. We've closed quotation ${s.number}; just reply if you'd like a revised quote.` }
    }
    if (intent === 'request_changes') return { ok: true, text: `Thanks, our team has your request about quotation ${s.number} and will send a revised quote.` }
    return { ok: false, text: 'Unknown request' }
  },
}
