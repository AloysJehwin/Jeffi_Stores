import { describe, it, expect } from 'vitest'
import {
  DRAFT_RESOURCES,
  DRAFT_RESOURCE_TYPES,
  isDraftResourceType,
  isLockOverrideRole,
  HOMEPAGE_ENTITY_ID,
  type DraftResourceType,
} from '../src/registry'
import { DRAFT_LOCK_EPOCH_HEADER, parseEpoch, DRAFT_LIST_SORTS, isDraftListSort } from '../src/index'

describe('registry', () => {
  it('exposes every type in DRAFT_RESOURCE_TYPES', () => {
    expect(DRAFT_RESOURCE_TYPES.length).toBe(Object.keys(DRAFT_RESOURCES).length)
    expect(DRAFT_RESOURCE_TYPES).toContain('product')
    expect(DRAFT_RESOURCE_TYPES).toContain('rfq_reply')
  })

  it('every def has sql + scopes + editHref', () => {
    for (const t of DRAFT_RESOURCE_TYPES) {
      const d = DRAFT_RESOURCES[t]
      expect(typeof d.existsSql).toBe('string')
      expect(typeof d.listSql).toBe('string')
      expect(typeof d.labelSql).toBe('string')
      expect(d.writeScope).toContain(':write')
      expect(d.readScope).toContain(':read')
      expect(typeof d.editHref).toBe('function')
    }
  })

  it('catalog readScope is derived from writeScope', () => {
    expect(DRAFT_RESOURCES.product.writeScope).toBe('products:write')
    expect(DRAFT_RESOURCES.product.readScope).toBe('products:read')
  })

  describe('isDraftResourceType', () => {
    it('true for a known type', () => expect(isDraftResourceType('product')).toBe(true))
    it('false for unknown string', () => expect(isDraftResourceType('nope')).toBe(false))
    it('false for non-string', () => {
      expect(isDraftResourceType(5)).toBe(false)
      expect(isDraftResourceType(null)).toBe(false)
      expect(isDraftResourceType(undefined)).toBe(false)
    })
    it('false for inherited Object props (hasOwnProperty guard)', () => {
      expect(isDraftResourceType('toString')).toBe(false)
      expect(isDraftResourceType('constructor')).toBe(false)
    })
  })

  describe('isLockOverrideRole', () => {
    it('true for administrator / super_admin', () => {
      expect(isLockOverrideRole('administrator')).toBe(true)
      expect(isLockOverrideRole('super_admin')).toBe(true)
    })
    it('false for other / null / undefined', () => {
      expect(isLockOverrideRole('manager')).toBe(false)
      expect(isLockOverrideRole(null)).toBe(false)
      expect(isLockOverrideRole(undefined)).toBe(false)
    })
  })

  describe('editHref variants', () => {
    it('branchHref: ref differs from id -> entity path with ?draft', () => {
      expect(DRAFT_RESOURCES.product.editHref('draft-9', 'ent-1')).toBe('/admin/products/ent-1/edit?draft=draft-9')
    })
    it('branchHref: ref equals id -> plain edit', () => {
      expect(DRAFT_RESOURCES.product.editHref('ent-1', 'ent-1')).toBe('/admin/products/ent-1/edit')
    })
    it('branchHref: no ref -> plain edit', () => {
      expect(DRAFT_RESOURCES.product.editHref('ent-1')).toBe('/admin/products/ent-1/edit')
    })
    it('campaign href uses kind, empty when absent', () => {
      expect(DRAFT_RESOURCES.campaign.editHref('x', 'welcome')).toBe('/admin/campaigns/welcome/edit')
      expect(DRAFT_RESOURCES.campaign.editHref('x')).toBe('/admin/campaigns//edit')
    })
    it('homepage href embeds the draft id', () => {
      expect(DRAFT_RESOURCES.homepage.editHref('d1')).toBe('/admin/settings/homepage?draft=d1')
    })
    it('rfq_reply href uses ref, empty when absent', () => {
      expect(DRAFT_RESOURCES.rfq_reply.editHref('d1', 'rfq-7')).toBe('/admin/business/rfqs/rfq-7')
      expect(DRAFT_RESOURCES.rfq_reply.editHref('d1')).toBe('/admin/business/rfqs/')
    })
    it('simple href builders', () => {
      expect(DRAFT_RESOURCES.invoice.editHref('o1')).toBe('/admin/invoices?view=edit&edit=o1')
      expect(DRAFT_RESOURCES.quotation.editHref('q1')).toBe('/admin/quotations?view=editor&edit=q1')
      expect(DRAFT_RESOURCES.purchase_order.editHref('p1')).toBe('/admin/purchase-orders?po=p1')
      expect(DRAFT_RESOURCES.po_new.editHref('n1')).toBe('/admin/purchase-orders/new?draftId=n1')
      expect(DRAFT_RESOURCES.po_receive.editHref('r1')).toBe('/admin/purchase-orders?po=r1')
      expect(DRAFT_RESOURCES.cash_sale.editHref('c1')).toBe('/admin/cash-sale?draft=c1')
      expect(DRAFT_RESOURCES.scenario.editHref('s1')).toBe('/admin/campaigns/scenarios/new?draft=s1')
      expect(DRAFT_RESOURCES.google_ads_campaign.editHref('g1')).toBe('/admin/google-ads?tab=drafts&draft=g1')
      expect(DRAFT_RESOURCES.mailer.editHref('m1')).toBe('/admin/marketing/messaging/new?draftId=m1')
      expect(DRAFT_RESOURCES.supplier.editHref('su1', 'su1')).toBe('/admin/suppliers/su1/edit')
      expect(DRAFT_RESOURCES.offer.editHref('of1', 'ent')).toBe('/admin/offers/ent/edit?draft=of1')
    })
  })

  it('HOMEPAGE_ENTITY_ID is the nil uuid', () => {
    expect(HOMEPAGE_ENTITY_ID).toBe('00000000-0000-0000-0000-000000000000')
  })
})

describe('index helpers', () => {
  it('epoch header constant', () => expect(DRAFT_LOCK_EPOCH_HEADER).toBe('x-draft-lock-epoch'))

  describe('parseEpoch', () => {
    it('null/empty/undefined -> null', () => {
      expect(parseEpoch(null)).toBeNull()
      expect(parseEpoch(undefined)).toBeNull()
      expect(parseEpoch('')).toBeNull()
    })
    it('non-negative integer string -> number', () => {
      expect(parseEpoch('0')).toBe(0)
      expect(parseEpoch('42')).toBe(42)
    })
    it('negative / non-integer / non-numeric -> null', () => {
      expect(parseEpoch('-1')).toBeNull()
      expect(parseEpoch('1.5')).toBeNull()
      expect(parseEpoch('abc')).toBeNull()
    })
  })

  describe('isDraftListSort', () => {
    it('true for every whitelisted sort', () => {
      for (const s of DRAFT_LIST_SORTS) expect(isDraftListSort(s)).toBe(true)
    })
    it('false for unknown / null / undefined', () => {
      expect(isDraftListSort('bogus')).toBe(false)
      expect(isDraftListSort(null)).toBe(false)
      expect(isDraftListSort(undefined)).toBe(false)
    })
  })
})
