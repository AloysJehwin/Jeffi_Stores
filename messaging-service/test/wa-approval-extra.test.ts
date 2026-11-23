import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/db.js', () => ({ db: { query: vi.fn(async () => ({ rows: [] })) } }))
vi.mock('../src/pools.js', () => ({ poolsForTenant: vi.fn() }))
vi.mock('../src/providers/policy.js', () => ({ messagingProvider: vi.fn(async () => 'twilio') }))
vi.mock('../src/templates-v2.js', async orig => ({ ...(await orig<any>()), findById: vi.fn(), setApprovalStatus: vi.fn() }))
const { twContent } = vi.hoisted(() => ({ twContent: {
  createContent: vi.fn(), submitForApproval: vi.fn(), deleteContent: vi.fn(), getApprovalStatus: vi.fn(),
  mapApprovalStatus: (s: string) => (s || '').toLowerCase() || 'pending',
} }))
vi.mock('../src/providers/twilio-content.js', () => twContent)

import { composeTypes, metaName, headerSample, awsTemplate, submit, syncTenant, syncAll, startApprovalSync } from '../src/wa-approval'
import { planSlots } from '@jeffi/api-contracts'
import * as tpl from '../src/templates-v2'
import { db } from '../src/db'
import { poolsForTenant } from '../src/pools'
import { messagingProvider } from '../src/providers/policy'

describe('composeTypes branches', () => {
  it('AUTHENTICATION → whatsapp/authentication', () => {
    expect(Object.keys(composeTypes('x', {}, 'AUTHENTICATION'))).toEqual(['whatsapp/authentication'])
  })
  it('carousel, media-only, quick-reply-only, and plain text', () => {
    expect(Object.keys(composeTypes('b', { carousel: { cards: [{ title: 'T', body: 'B' }] } }))).toEqual(['twilio/carousel'])
    expect(Object.keys(composeTypes('b', { types: { 'twilio/media': { media: ['https://x/a.png'] } } }))).toEqual(['twilio/media'])
    expect(Object.keys(composeTypes('b', { buttons: [{ type: 'quick_reply', label: 'Yes' }] }))).toEqual(['twilio/quick-reply'])
    expect(Object.keys(composeTypes('b', {}))).toEqual(['twilio/text'])
    // phone button → call-to-action
    expect(Object.keys(composeTypes('b', { buttons: [{ type: 'phone', label: 'Call', value: '+91' }] }))).toEqual(['twilio/call-to-action'])
  })
})

describe('metaName / headerSample', () => {
  it('metaName slugifies and caps length', () => {
    expect(metaName(undefined, 'a/b', 2)).toBe('jeffi_a_b_v2')
  })
  it('headerSample fills the media placeholder, or returns null without media', () => {
    const plan = planSlots('Hi {{1}}.', { types: { 'twilio/media': { media: ['https://cdn/{{1}}.png'] } } }, { 1: 'a' })
    expect(headerSample(plan)).toContain('https://cdn/')
    expect(headerSample(planSlots('Hi.', {}))).toBeNull()
  })
})

describe('awsTemplate AUTHENTICATION + carousel', () => {
  it('builds the OTP definition for AUTHENTICATION', () => {
    const r = awsTemplate('otp_v1', 'en', 'AUTHENTICATION', planSlots('{{1}}', {}))
    expect(r.definition.components.map((c: any) => c.type)).toEqual(['BODY', 'FOOTER', 'BUTTONS'])
    expect(r.ref).toMatch(/otp/)
  })
  it('refuses carousels on AWS', () => {
    expect(() => awsTemplate('c_v1', 'en', 'UTILITY', planSlots('b', { carousel: { cards: [{ body: 'x' }] } })))
      .toThrow(/Carousel templates are not supported/)
  })
})

describe('submit via Twilio', () => {
  const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) }
  beforeEach(() => {
    pool.query.mockClear()
    for (const f of Object.values(twContent)) if (typeof f === 'object' || (f as any).mockReset) (f as any).mockReset?.()
    vi.mocked(messagingProvider).mockResolvedValue('twilio')
  })

  it('creates content, submits for approval and records the SID + status', async () => {
    vi.mocked(tpl.findById).mockResolvedValue({
      family: { slug: 'order/confirmed' }, template: { channel: 'whatsapp' },
      variant: { id: 'v1', locale: 'en', approval_status: 'draft', meta_category: 'UTILITY' },
      version: { id: 'ver1', body: 'Your order {{1}} is confirmed. Thank you for shopping with us.', blocks: {}, version: 2, provider_ref: null },
    } as any)
    twContent.createContent.mockResolvedValue({ sid: 'HX9' })
    twContent.submitForApproval.mockResolvedValue({ status: 'received' })
    const r = await submit(pool as any, 't1', 'acme', 'tpl1')
    expect(r).toMatchObject({ sid: 'HX9', status: 'received' })
    expect(twContent.createContent).toHaveBeenCalled()
    expect(pool.query.mock.calls[0][0]).toMatch(/template_version SET provider_ref/)
  })

  it('rejects a non-whatsapp template and a missing one', async () => {
    vi.mocked(tpl.findById).mockResolvedValue(null as any)
    await expect(submit(pool as any, 't1', 'acme', 'x')).rejects.toMatchObject({ status: 404 })
    vi.mocked(tpl.findById).mockResolvedValue({ template: { channel: 'sms' }, variant: { id: 'v' }, version: { id: 'ver', body: 'b', blocks: {} } } as any)
    await expect(submit(pool as any, 't1', 'acme', 'x')).rejects.toMatchObject({ status: 400 })
  })

  it('refuses a re-submit of an already submitted/approved version', async () => {
    vi.mocked(tpl.findById).mockResolvedValue({
      family: { slug: 's' }, template: { channel: 'whatsapp' },
      variant: { id: 'v1', locale: 'en', approval_status: 'approved', meta_category: 'UTILITY' },
      version: { id: 'ver1', body: 'b', blocks: {}, version: 1, provider_ref: 'HX1' },
    } as any)
    await expect(submit(pool as any, 't1', 'acme', 'x')).rejects.toMatchObject({ status: 409 })
  })

  it('cleans up the content and 502s when Meta submission fails', async () => {
    vi.mocked(tpl.findById).mockResolvedValue({
      family: { slug: 's' }, template: { channel: 'whatsapp' },
      variant: { id: 'v1', locale: 'en', approval_status: 'draft', meta_category: 'UTILITY' },
      version: { id: 'ver1', body: 'Your order {{1}} is confirmed. Thank you for shopping with us.', blocks: {}, version: 1, provider_ref: null },
    } as any)
    twContent.createContent.mockResolvedValue({ sid: 'HX9' })
    twContent.submitForApproval.mockRejectedValue(new Error('meta no'))
    twContent.deleteContent.mockResolvedValue({})
    await expect(submit(pool as any, 't1', 'acme', 'x')).rejects.toMatchObject({ status: 502 })
    expect(twContent.deleteContent).toHaveBeenCalledWith('HX9')
  })

  it('422s when the body fails Meta validation', async () => {
    vi.mocked(tpl.findById).mockResolvedValue({
      family: { slug: 's' }, template: { channel: 'whatsapp' },
      variant: { id: 'v1', locale: 'en', approval_status: 'draft', meta_category: 'MARKETING' },
      version: { id: 'ver1', body: '{{1}} starts {{3}}', blocks: {}, version: 1, provider_ref: null },
    } as any)
    await expect(submit(pool as any, 't1', 'acme', 'x')).rejects.toMatchObject({ status: 422 })
  })
})

describe('syncTenant via Twilio', () => {
  it('promotes an approved SID, counts rejected, swallows a bad one', async () => {
    const pool = { query: vi.fn(async (sql: string) =>
      sql.includes('FROM template_variant v') ? { rows: [{ id: 'a', sid: 'HXa' }, { id: 'b', sid: 'HXb' }, { id: 'c', sid: 'HXc' }] } : { rows: [], rowCount: 1 }) }
    twContent.getApprovalStatus
      .mockResolvedValueOnce({ whatsapp: { status: 'approved' } })
      .mockResolvedValueOnce({ whatsapp: { status: 'rejected', rejection_reason: 'nope' } })
      .mockRejectedValueOnce(new Error('transient'))
    const r = await syncTenant(pool as any, 't1')
    expect(r).toEqual({ checked: 2, changed: 2 })
    expect(tpl.setApprovalStatus).toHaveBeenCalled()
  })
})

describe('syncAll / startApprovalSync', () => {
  afterEach(() => { for (const k of ['WA_APPROVAL_SYNC_MS', 'TWILIO_ACCOUNT_SID', 'AWS_WHATSAPP_WABA_ID']) delete process.env[k] })

  it('iterates the platform + active tenants, logging a failure but continuing', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [{ id: 'ten1' }] } as any)
    vi.mocked(poolsForTenant)
      .mockResolvedValueOnce({ pool: { query: vi.fn(async () => ({ rows: [] })) } } as any) // platform
      .mockRejectedValueOnce(Object.assign(new Error('bad'), { code: 'XXX' }))               // ten1
    const log = vi.fn()
    const r = await syncAll(log)
    expect(r).toEqual({ checked: 0, changed: 0 })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ten1'))
  })

  it('startApprovalSync is a no-op without a provider or interval', () => {
    process.env.WA_APPROVAL_SYNC_MS = '0'
    expect(startApprovalSync(() => {}, { tenantId: null, skipStoreTenants: false })).toBeUndefined()
  })
})
