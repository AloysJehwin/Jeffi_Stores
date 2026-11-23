import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/db.js', () => ({ db: { query: vi.fn() } }))

import { db } from '../src/db'
import {
  getSettings, putSettings, standardAllowed, assertCanEdit, markReview, reviewDecision, reviewQueue,
  type MessagingSettings,
} from '../src/governance'

const PLATFORM = '00000000-0000-0000-0000-000000000000'
const DEFAULTS: MessagingSettings = { standard_templates: 'all', allowed: [], editing_enabled: true, review_required: false }

describe('governance settings', () => {
  beforeEach(() => vi.mocked(db.query).mockReset())

  it('returns the defaults for the platform tenant without querying', async () => {
    expect(await getSettings(PLATFORM)).toEqual(DEFAULTS)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('returns the stored row, else defaults, and never throws on a DB error', async () => {
    const stored = { standard_templates: 'selected', allowed: [{ channel: 'sms', slug: 'otp' }], editing_enabled: false, review_required: true }
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [stored] } as any)
    expect(await getSettings('t1')).toEqual(stored)
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] } as any)
    expect(await getSettings('t2')).toEqual(DEFAULTS)
    vi.mocked(db.query).mockRejectedValueOnce(new Error('down'))
    expect(await getSettings('t3')).toEqual(DEFAULTS)
  })

  it('putSettings merges over current and upserts the JSON-encoded allow list', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] } as any) // getSettings (current) → defaults
      .mockResolvedValueOnce({ rows: [] } as any) // INSERT
      .mockResolvedValueOnce({ rows: [{ ...DEFAULTS, editing_enabled: false }] } as any) // getSettings (return)
    const out = await putSettings('t1', { editing_enabled: false }, 'admin')
    const insert = vi.mocked(db.query).mock.calls[1]
    expect(String(insert[0])).toMatch(/INSERT INTO messaging_tenant_settings/)
    expect(insert[1]).toEqual(['t1', 'all', JSON.stringify([]), false, false, 'admin'])
    expect(out.editing_enabled).toBe(false)
  })
})

describe('governance rules', () => {
  it('standardAllowed: all allows everything; selected gates by channel+slug', () => {
    expect(standardAllowed(DEFAULTS, 'sms', 'otp')).toBe(true)
    const sel: MessagingSettings = { ...DEFAULTS, standard_templates: 'selected', allowed: [{ channel: 'sms', slug: 'otp' }] }
    expect(standardAllowed(sel, 'sms', 'otp')).toBe(true)
    expect(standardAllowed(sel, 'sms', 'welcome')).toBe(false)
    expect(standardAllowed(sel, 'email', 'otp')).toBe(false)
  })

  it('assertCanEdit: admin is never blocked; a non-admin is blocked only when editing is disabled', () => {
    const locked: MessagingSettings = { ...DEFAULTS, editing_enabled: false }
    expect(() => assertCanEdit(locked, true)).not.toThrow()
    expect(() => assertCanEdit(DEFAULTS, false)).not.toThrow()
    expect(() => assertCanEdit(locked, false)).toThrow(/managed by Jeffi/)
    try { assertCanEdit(locked, false) } catch (e: any) { expect(e).toMatchObject({ status: 403, code: 'template_editing_disabled' }) }
  })
})

describe('governance review state machine', () => {
  const pool = { query: vi.fn() }
  beforeEach(() => pool.query.mockReset())

  it('markReview approves (promotes approved_version_id) or marks pending', async () => {
    pool.query.mockResolvedValue({ rowCount: 1 })
    await markReview(pool as any, 'v1', true, 'admin')
    expect(String(pool.query.mock.calls[0][0])).toMatch(/review_status='approved'/)
    expect(pool.query.mock.calls[0][1]).toEqual(['v1', 'admin'])
    await markReview(pool as any, 'v1', false, 'admin')
    expect(String(pool.query.mock.calls[1][0])).toMatch(/review_status='pending'/)
    expect(pool.query.mock.calls[1][1]).toEqual(['v1'])
  })

  it('reviewDecision returns whether a pending row was updated', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1 })
    expect(await reviewDecision(pool as any, 't1', 'tpl1', 'approved', 'ok', 'admin')).toBe(true)
    expect(String(pool.query.mock.calls[0][0])).toMatch(/review_status='approved'/)
    pool.query.mockResolvedValueOnce({ rowCount: 0 })
    expect(await reviewDecision(pool as any, 't1', 'tpl1', 'rejected', null, 'admin')).toBe(false)
    expect(String(pool.query.mock.calls[1][0])).toMatch(/review_status='rejected'/)
  })

  it('reviewQueue returns the pending/rejected rows', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'tpl1', review_status: 'pending' }] })
    expect(await reviewQueue(pool as any, 't1')).toEqual([{ id: 'tpl1', review_status: 'pending' }])
    expect(pool.query.mock.calls[0][1]).toEqual(['t1'])
  })
})
