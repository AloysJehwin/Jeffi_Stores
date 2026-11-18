import { describe, it, expect, vi, beforeEach } from 'vitest'

// A Showcase's enquiries inbox (showcase_leads through the control-plane pool): saving one, listing the open ones,
// and marking them handled (read_at) or open again.

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/tenant-registry/shared', () => ({ controlPlanePool: () => ({ query }), RESERVED_LABELS: new Set<string>() }))

import { insertShowcaseLead, listShowcaseLeads, markShowcaseLeadsRead } from '@/lib/showcase/store'

const ROW = { id: 'lead-1', site_id: 'site-1', name: 'Priya', phone: null, email: 'priya@example.com', message: null, created_at: new Date('2026-11-18T10:00:00Z'), read_at: null }

describe('Showcase enquiries', () => {
  beforeEach(() => query.mockReset())

  it('saves blanks as NULL and returns the enquiry', async () => {
    query.mockResolvedValueOnce({ rows: [ROW] })
    const lead = await insertShowcaseLead('site-1', { name: 'Priya', phone: '', email: 'priya@example.com', message: '' })
    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO showcase_leads/)
    expect(query.mock.calls[0][1]).toEqual(['site-1', 'Priya', null, 'priya@example.com', null])
    expect(lead).toEqual({ id: 'lead-1', siteId: 'site-1', name: 'Priya', phone: null, email: 'priya@example.com', message: null, createdAt: '2026-11-18T10:00:00.000Z', readAt: null })
  })

  it('lists the open ones newest first, and counts the whole inbox', async () => {
    query.mockResolvedValueOnce({ rows: [ROW] }).mockResolvedValueOnce({ rows: [{ total: 3, unread: 1 }] })
    const page = await listShowcaseLeads('site-1', { unread: true, limit: 500, offset: -4 })
    const [sql, params] = query.mock.calls[0]
    expect(sql).toMatch(/WHERE site_id = \$1 AND read_at IS NULL\s+ORDER BY created_at DESC/)
    expect(params).toEqual(['site-1', 200, 0])
    expect(page).toMatchObject({ total: 3, unread: 1, leads: [{ id: 'lead-1' }] })
  })

  it('marks the chosen ones handled, or all of the site', async () => {
    query.mockResolvedValue({ rowCount: 2 })
    expect(await markShowcaseLeadsRead('site-1', ['a', 'b'])).toBe(2)
    expect(query.mock.calls[0][0]).toMatch(/SET read_at = now\(\)\s+WHERE site_id = \$1 AND read_at IS NULL AND id = ANY\(\$2::uuid\[\]\)/)
    expect(query.mock.calls[0][1]).toEqual(['site-1', ['a', 'b']])
    await markShowcaseLeadsRead('site-1', 'all')
    expect(query.mock.calls[1][0]).not.toMatch(/ANY/)
    expect(query.mock.calls[1][1]).toEqual(['site-1'])
  })

  it('opens handled ones again, and asks nothing for an empty pick', async () => {
    query.mockResolvedValue({ rowCount: 1 })
    await markShowcaseLeadsRead('site-1', ['a'], false)
    expect(query.mock.calls[0][0]).toMatch(/SET read_at = NULL\s+WHERE site_id = \$1 AND read_at IS NOT NULL/)
    expect(await markShowcaseLeadsRead('site-1', [])).toBe(0)
    expect(query).toHaveBeenCalledOnce()
  })
})
