import { describe, it, expect } from 'vitest'
import { CATALOG, ORDER_PAGE_VARS } from '../seed/catalog.js'
import before from '../seed/email-catalog-v1.json' with { type: 'json' }
import { tokenKeys } from '../src/render.js'

// A send with an unfilled token fails (422), so a rewritten email may only use the tokens its callers
// already pass, the ones every send gets, and on order-page templates the order's own details.
const SYSTEM = ['store_name', 'brand_name', 'store_email', 'store_phone', 'store_web', 'current_year', 'date', 'customer_first_name', 'customer_name', 'customer_last_name', 'customer_email']
const old = new Map(before.map(t => [t.slug, new Set(tokenKeys(`${t.subject ?? ''} ${t.body}`))]))
const emails = CATALOG.filter(t => t.channel === 'email')

describe('email catalog', () => {
  it.each(emails.map(t => [t.slug, t] as const))('%s only uses tokens its senders fill', (_slug, t) => {
    const allowed = new Set([...SYSTEM, ...(old.get(t.slug) ?? []), ...(t.tags?.includes('page:order') ? ORDER_PAGE_VARS : [])])
    const used = tokenKeys(`${t.subject ?? ''} ${t.preheader ?? ''} ${t.body}`)
    expect(used.filter(k => !allowed.has(k))).toEqual([])
  })

  it('every email has a subject without emojis and a preview line', () => {
    const bad = emails.filter(t => !t.subject || /\p{Extended_Pictographic}/u.test(t.subject) || !t.preheader).map(t => t.slug)
    expect(bad).toEqual([])
  })

  it('a new email is an order-page template', () => {
    expect(emails.filter(t => !old.has(t.slug) && !t.tags?.includes('page:order')).map(t => t.slug)).toEqual([])
  })
})
