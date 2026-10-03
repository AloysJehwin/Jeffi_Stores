import { describe, it, expect } from 'vitest'
import { BUILTIN_TEMPLATES, getBuiltinTemplate } from '@/lib/campaigns/default-templates'
import { validateCampaignBodyTemplate } from '@/lib/campaigns/template-validation'

describe('BUILTIN_TEMPLATES', () => {
  it('every template passes validation for its own kind (so images/tokens are correct)', () => {
    for (const [kind, tpl] of Object.entries(BUILTIN_TEMPLATES)) {
      const r = validateCampaignBodyTemplate(tpl.body, { kind, scenarioKind: kind })
      expect(r.ok, `${kind}: ${r.ok ? '' : (r as any).reason}`).toBe(true)
    }
  })

  it('every template has a non-empty subject and body', () => {
    for (const [kind, tpl] of Object.entries(BUILTIN_TEMPLATES)) {
      expect(tpl.subject.trim().length, kind).toBeGreaterThan(0)
      expect(tpl.body.trim().length, kind).toBeGreaterThan(0)
    }
  })

  it('multi-product kinds include {itemsHtml}; single-product kinds include {productCard}', () => {
    const multi = [
      'viewed_product',
      'viewed_category',
      'high_value_cart',
      'cart_price_drop',
      'wishlist_reminder',
      'replenishment',
      'subscription_renewal',
    ]
    const single = ['back_in_stock_wishlist', 'review_photo_followup']
    for (const k of multi) expect(BUILTIN_TEMPLATES[k].body, k).toContain('{itemsHtml}')
    for (const k of single) expect(BUILTIN_TEMPLATES[k].body, k).toContain('{productCard}')
  })

  it('incentive kinds include the coupon token', () => {
    for (const k of [
      'first_purchase_nudge',
      'second_purchase_nudge',
      'signup_anniversary',
      'birthday',
      'referral_invite',
      'loyalty_tier_upgrade',
    ]) {
      expect(BUILTIN_TEMPLATES[k].body, k).toContain('{couponCode}')
    }
  })

  it('every template body includes a CTA link token', () => {
    for (const [kind, tpl] of Object.entries(BUILTIN_TEMPLATES)) {
      expect(tpl.body, kind).toContain('{ctaUrl}')
    }
  })

  it('getBuiltinTemplate returns null for an unknown kind', () => {
    expect(getBuiltinTemplate('nope')).toBeNull()
  })
})
