import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/shared/mail-audit', () => ({ sendAuditedMail: vi.fn() }))
vi.mock('@/lib/shared/customer-links', () => ({ apiBaseUrl: vi.fn() }))

import { renderConditionals, isTruthyVar } from '@/lib/templates/variables-shared'
import { BUILTIN_TEMPLATES, RETIRED_BUILTIN_TEMPLATES } from '@/lib/campaigns/default-templates'
import { renderCampaignTemplate } from '@/lib/shared/automation-emails'

const REGISTERED = { store_name: 'Acme Tools', customer_first_name: 'Asha' }
const BASE = {
  firstName: 'Asha',
  itemCount: 2,
  itemsHtml: '<table></table>',
  ctaUrl: 'https://acme.in',
  tier: 'Gold',
  points: 250,
}
const WITH = { ...BASE, couponCode: 'SAVE10', discountPercent: 10 }
const WITHOUT = { ...BASE, couponCode: '', discountPercent: 0 }

const render = (body: string, vars: Record<string, string | number>) =>
  renderCampaignTemplate(body, vars, REGISTERED, true)

describe('renderConditionals', () => {
  it('keeps the block when the var is set, drops it when empty / 0 / missing', () => {
    expect(renderConditionals('a{#if x}B{/if}c', { x: 'y' })).toBe('aBc')
    for (const x of ['', 0, '0', undefined]) expect(renderConditionals('a{#if x}B{/if}c', { x })).toBe('ac')
    expect(renderConditionals('a{#if x}B{/if}c', {})).toBe('ac')
  })

  it('supports else and nesting', () => {
    const t = '{#if a}A{#if b}B{#else}nb{/if}{#else}none{/if}'
    expect(renderConditionals(t, { a: 1, b: 1 })).toBe('AB')
    expect(renderConditionals(t, { a: 1 })).toBe('Anb')
    expect(renderConditionals(t, {})).toBe('none')
  })

  it('isTruthyVar', () => {
    expect(isTruthyVar('10')).toBe(true)
    expect(isTruthyVar(' 0 ')).toBe(false)
  })
})

const AFFECTED = [
  'first_purchase_nudge',
  'birthday',
  'second_purchase_nudge',
  'signup_anniversary',
  'loyalty_tier_upgrade',
  'high_value_cart',
]

describe.each(AFFECTED)('%s', kind => {
  const t = BUILTIN_TEMPLATES[kind]

  it('with a coupon: renders the box (and the discount where the template has one)', () => {
    const body = render(t.body, WITH)
    expect(body).toContain('SAVE10')
    expect(body).toContain('border:1px dashed #e07b3f')
    if (t.body.includes('{discountPercent}')) expect(body).toContain('10% off')
    expect(body).not.toMatch(/\{#if|\{\/if\}|\{#else\}/)
  })

  it('without a coupon and 0%: no empty box, no "0%" copy, nothing token-shaped', () => {
    const body = render(t.body, WITHOUT)
    const subject = renderCampaignTemplate(t.subject, WITHOUT, REGISTERED, false)
    expect(body).not.toContain('border:1px dashed #e07b3f')
    expect(body).not.toMatch(/\b0% off/)
    expect(body).not.toContain('— .')
    expect(body + subject).not.toMatch(/\{[#/]?\w*\}?/)
    expect(body).toContain('href="https://acme.in"')
  })
})

describe('legacy stored templates', () => {
  it('drops a bare coupon box when there is no coupon', () => {
    const old = RETIRED_BUILTIN_TEMPLATES.high_value_cart[0].body
    expect(render(old, WITHOUT)).not.toContain('border:1px dashed #e07b3f')
    expect(render(old, WITH)).toContain('SAVE10')
  })

  it('every changed default has its previous version retired, so unedited rows migrate', () => {
    for (const kind of AFFECTED) expect(RETIRED_BUILTIN_TEMPLATES[kind]?.length, kind).toBeGreaterThan(0)
  })
})
