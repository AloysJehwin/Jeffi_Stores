import { buildWhere, type FilterQuery } from '@jeffi/list-filters'
import { queryMany, entityOrderBy } from '@/lib/queries/shared'
import { ORDERS_ENTITY } from '@/lib/filters/entities/orders'
import { sendAdminContactEmail } from '@/lib/email'
import { renderTemplate } from '@/lib/templates/variables'
import { PAGES } from '@/lib/messaging/placements'
import { askAboutOrder } from '@/lib/replies/ask'
import { orderMailVars, unfilledTokens } from './customer-mail'

// One email per order to the customers of every order a list's filters match (the Orders list's
// Mail button). Each order goes through what the order page's own send does: its details fill the
// tokens, and an order that would go out with a gap is skipped, never sent with one.

/** The most orders one send covers. More than this and the administrator narrows the filters. */
export const BULK_MAIL_CAP = 500
/** Up to this many orders the request waits and reports the outcome; above it the send runs on after the response. */
export const BULK_MAIL_INLINE = 20
const CONCURRENCY = 4

export interface BulkMailOrder {
  id: string
  orderNumber: string
}

/** The orders the list's filters match, in the list's order, up to the cap (`capped` when more match). */
export async function ordersForMail(
  q: FilterQuery,
  opts: { sort?: string; dir?: string; cap?: number } = {}
): Promise<{ orders: BulkMailOrder[]; capped: boolean }> {
  const cap = opts.cap ?? BULK_MAIL_CAP
  const ctx = (await ORDERS_ENTITY.context?.(q)) ?? {}
  const w = buildWhere(ORDERS_ENTITY, q, 1, { ctx })
  const rows = await queryMany<{ id: string; order_number: string }>(
    `SELECT o.id::text, o.order_number FROM orders o ${w.where} ${entityOrderBy(ORDERS_ENTITY, opts.sort, opts.dir)} LIMIT $${w.nextIdx}`,
    [...w.params, cap + 1]
  )
  return { orders: rows.slice(0, cap).map(r => ({ id: r.id, orderNumber: r.order_number })), capped: rows.length > cap }
}

export interface BulkMail {
  subject: string
  body: string
  preheader?: string
  isHtml?: boolean
  layout?: 'template' | 'message' | 'raw'
  /** The order-page scenario of the template; one whose reply is read sends with a reply address. */
  scenario?: string
}

export interface BulkMailResult {
  total: number
  sent: number
  /** Orders with no customer email. */
  noEmail: number
  /** Orders that had nothing for a token the email uses (e.g. no tracking link yet). */
  missing: number
  failed: number
  /** The first few orders not emailed, with why. */
  notSent: { orderNumber: string; reason: string }[]
}

type NotSent = { kind: 'noEmail' | 'missing' | 'failed'; reason: string }

async function sendOne(order: BulkMailOrder, mail: BulkMail): Promise<'sent' | NotSent> {
  const preheader = mail.preheader ?? ''
  const texts = [mail.subject, mail.body, preheader]
  const usesPaymentLink = texts.some(t => /payment_url/i.test(t))
  const scenario = PAGES.order.scenarios.find(s => s.id === mail.scenario) ?? null
  // Check before creating a payment link: an order that would go out with gaps creates nothing.
  const check = await orderMailVars(order.id, { usesPaymentLink })
  if (!check) return { kind: 'failed', reason: 'order not found' }
  if (!check.recipient.email) return { kind: 'noEmail', reason: 'no customer email' }
  const gaps = unfilledTokens(texts, check.vars)
  if (gaps.length) return { kind: 'missing', reason: `nothing for ${gaps.map(k => `{{${k}}}`).join(', ')}` }

  const { vars, recipient } = usesPaymentLink ? (await orderMailVars(order.id, { usesPaymentLink, createPaymentLink: true }))! : check
  const send = () =>
    sendAdminContactEmail(
      recipient.email,
      recipient.name,
      renderTemplate(mail.subject.trim(), vars),
      renderTemplate(mail.body.trim(), vars, { escape: !!mail.isHtml }),
      { isHtml: !!mail.isHtml, layout: mail.layout, preheader: renderTemplate(preheader, vars), entityType: 'orders', entityId: order.id }
    )
  const result = scenario?.reply ? await askAboutOrder(scenario.reply, order.id, send) : await send()
  return result.success ? 'sent' : { kind: 'failed', reason: 'the email could not be sent' }
}

/** Email each order's customer, a few at a time. Never throws: an order that fails is counted and the rest go on. */
export async function sendOrdersMail(orders: BulkMailOrder[], mail: BulkMail): Promise<BulkMailResult> {
  const out: BulkMailResult = { total: orders.length, sent: 0, noEmail: 0, missing: 0, failed: 0, notSent: [] }
  let next = 0
  const worker = async () => {
    for (;;) {
      const order = orders[next++]
      if (!order) return
      const r = await sendOne(order, mail).catch((e: unknown): NotSent => ({ kind: 'failed', reason: e instanceof Error ? e.message : 'failed' }))
      if (r === 'sent') out.sent++
      else {
        out[r.kind]++
        if (out.notSent.length < 25) out.notSent.push({ orderNumber: order.orderNumber, reason: r.reason })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, orders.length) }, worker))
  return out
}

/** "Emailed 12 of 14 orders (1 without an email, 1 with nothing for a token the email uses)." */
export function bulkMailSummary(r: BulkMailResult): string {
  const why = [
    r.noEmail ? `${r.noEmail} without an email` : '',
    r.missing ? `${r.missing} with nothing for a token the email uses` : '',
    r.failed ? `${r.failed} failed` : '',
  ].filter(Boolean)
  return `Emailed ${r.sent} of ${r.total} order${r.total === 1 ? '' : 's'}${why.length ? ` (${why.join(', ')})` : ''}.`
}
