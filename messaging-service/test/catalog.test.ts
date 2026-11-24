import { describe, it, expect } from 'vitest'
import { CATALOG, ORDER_PAGE_VARS } from '../seed/catalog.js'
import before from '../seed/email-catalog-v1.json' with { type: 'json' }
import { tokenKeys } from '../src/render.js'
import { metaSamples, placeholders, planSlots, validateForMeta } from '@jeffi/api-contracts'

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

describe('sms catalog DLT ids', () => {
  it('carries an optional dltTemplateId on SMS seeds and never on other channels', () => {
    expect(CATALOG.filter(t => t.channel !== 'sms' && t.dltTemplateId)).toEqual([])
    expect(CATALOG.every(t => t.dltTemplateId === undefined || /^\d{10,40}$/.test(t.dltTemplateId))).toBe(true)
  })
})

describe('outreach WhatsApp templates', () => {
  const outreach = CATALOG.filter(t => t.channel === 'whatsapp' && t.slug.startsWith('outreach/'))
  const SLUGS = ['preview_ready', 'details_needed', 'site_live', 'claim', 'callback', 'trial_ending']

  it('has every template in English and Hindi', () => {
    expect(outreach.map(t => t.slug).sort()).toEqual(SLUGS.flatMap(s => [`outreach/${s}`, `outreach/${s}_hi`]).sort())
    for (const t of outreach) expect(t.locale).toBe(t.slug.endsWith('_hi') ? 'hi' : 'en')
  })

  it.each(outreach.map(t => [t.slug, t] as const))('%s passes the Meta checks as UTILITY with one link button', (_slug, t) => {
    expect(t.meta_category).toBe('UTILITY')
    expect(validateForMeta(t.body, t.blocks, metaSamples(t.body, t.blocks))).toEqual([])
    const plan = planSlots(t.body, t.blocks)
    const k = plan.bodySlots.length
    expect(plan.bodySlots).toEqual(Array.from({ length: k }, (_, i) => String(i + 1)))
    expect(plan.brandSlot).toBe(String(k + 1))
    expect(plan.links).toEqual([{ from: String(k + 2), to: String(k + 2) }])
    expect(plan.blocks.buttons).toEqual([expect.objectContaining({ type: 'url', value: `https://img.jeffistores.in/{{${k + 2}}}` })])
    expect(t.body.endsWith('\n— from {{brand_name}} team')).toBe(true)
  })

  it('keeps the Hindi copy on the same variables as the English one', () => {
    for (const s of SLUGS) {
      const en = outreach.find(t => t.slug === `outreach/${s}`)!
      const hi = outreach.find(t => t.slug === `outreach/${s}_hi`)!
      expect(placeholders(hi.body)).toEqual(placeholders(en.body))
    }
  })
})
