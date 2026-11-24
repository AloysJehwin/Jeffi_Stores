import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/admin/draft-branches', () => ({ draftsOf: vi.fn(), getDraftRow: vi.fn() }))
vi.mock('@/lib/admin/offer-drafts', () => ({ offerDrafts: { kind: 'offer' }, offerFieldsOf: vi.fn((x: unknown) => x) }))
vi.mock('@/lib/admin/entity-revisions', () => ({ recordDirectRevision: vi.fn() }))
vi.mock('@/lib/admin/draft-locks', () => ({
  actorOf: vi.fn(() => 'actor'),
  closeIfLocked: vi.fn(),
  discardGuard: vi.fn(),
  draftLockResponse: vi.fn(),
  epochFrom: vi.fn(() => 3),
  withDraftWrite: vi.fn(),
}))

import { PATCH, DELETE } from '@admin/app/api/(admin)/admin/product-offers/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne, withTransaction } from '@/lib/shared/db'
import { draftsOf, getDraftRow } from '@/lib/admin/draft-branches'
import { recordDirectRevision } from '@/lib/admin/entity-revisions'
import { closeIfLocked, discardGuard, draftLockResponse, withDraftWrite } from '@/lib/admin/draft-locks'

const admin = { adminId: 'a1', username: 'a', role: 'admin', scopes: [] }
const ctx = { params: Promise.resolve({ id: 'of1' }) }
const patch = (body: unknown, qs = '') =>
  PATCH(new NextRequest(`http://localhost/x${qs}`, { method: 'PATCH', body: JSON.stringify(body) }), ctx)
const del = () => DELETE(new NextRequest('http://localhost/x', { method: 'DELETE' }), ctx)

describe('/api/admin/product-offers/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  describe('PATCH', () => {
    it('returns 401 and 403', async () => {
      vi.mocked(authenticateAdmin).mockResolvedValue(null)
      expect((await patch({ title: 'x' })).status).toBe(401)
      vi.mocked(authenticateAdmin).mockResolvedValue(admin)
      vi.mocked(hasScope).mockReturnValue(false)
      expect((await patch({ title: 'x' })).status).toBe(403)
      expect(query).not.toHaveBeenCalled()
    })

    it('returns 400 for an invalid body or no fields', async () => {
      expect((await patch({ title: '' })).status).toBe(400)
      expect((await patch({ imageUrl: 'not-a-url' })).status).toBe(400)
      expect((await patch({})).status).toBe(400)
    })

    it('returns 404 when the named draft belongs to another offer', async () => {
      vi.mocked(getDraftRow).mockResolvedValue({ id: 'd1', offer_id: 'other' } as never)
      expect((await patch({ title: 'x' }, '?draft=d1')).status).toBe(404)
    })

    it('writes media straight to the live row and returns it', async () => {
      vi.mocked(query).mockResolvedValue({ rowCount: 1, rows: [] } as never)
      vi.mocked(queryOne).mockResolvedValue({ id: 'of1' })
      const res = await patch({ imageUrl: 'https://cdn/a.png', blurhash: 'bh' })
      expect(await res.json()).toEqual({ offer: { id: 'of1' } })
      expect(vi.mocked(query).mock.calls[0][0]).toMatch(/image_url = \$1, blurhash = \$2/)
      expect(vi.mocked(query).mock.calls[0][1]).toEqual(['https://cdn/a.png', 'bh', 'of1'])
    })

    it('returns 404 when the media update hits no row', async () => {
      vi.mocked(query).mockResolvedValue({ rowCount: 0, rows: [] } as never)
      expect((await patch({ imageUrl: '/images/a.png' })).status).toBe(404)
    })

    it('merges copy fields into the draft when ?draft is given', async () => {
      vi.mocked(getDraftRow).mockResolvedValue({ id: 'd1', offer_id: 'of1' } as never)
      vi.mocked(withDraftWrite).mockResolvedValue({ id: 'd1' } as never)
      const res = await patch({ title: 'New', badgeText: 'Hot' }, '?draft=d1')
      expect(await res.json()).toEqual({ draft: { id: 'd1' } })
      const run = vi.mocked(withDraftWrite).mock.calls[0][3] as (db: unknown) => Promise<unknown>
      const dbQuery = vi.fn().mockResolvedValue({ rows: [{ id: 'd1' }] })
      await run({ query: dbQuery })
      expect(dbQuery.mock.calls[0][1]).toEqual([JSON.stringify({ title: 'New', badge_text: 'Hot' }), 'd1'])
    })

    it('returns the lock response from a draft write', async () => {
      vi.mocked(getDraftRow).mockResolvedValue({ id: 'd1', offer_id: 'of1' } as never)
      vi.mocked(withDraftWrite).mockRejectedValue(new Error('locked'))
      vi.mocked(draftLockResponse).mockReturnValue(NextResponse.json({ error: 'locked' }, { status: 423 }) as never)
      expect((await patch({ title: 'x' }, '?draft=d1')).status).toBe(423)
    })

    it('commits copy fields to the live row and records a revision', async () => {
      vi.mocked(query).mockResolvedValue({ rows: [{ before: { title: 'a' }, after: { title: 'b' } }] } as never)
      vi.mocked(queryOne).mockResolvedValue({ id: 'of1', title: 'b' })
      const res = await patch({ title: 'b', isActive: false })
      expect(await res.json()).toEqual({ offer: { id: 'of1', title: 'b' } })
      expect(vi.mocked(query).mock.calls[0][1]).toEqual(['b', false, 'of1'])
      expect(recordDirectRevision).toHaveBeenCalledWith(expect.objectContaining({ type: 'offer', id: 'of1', actorAdminId: 'a1' }))
    })

    it('returns 404 when the live row is gone', async () => {
      vi.mocked(query).mockResolvedValue({ rows: [] } as never)
      vi.mocked(queryOne).mockResolvedValue(null)
      expect((await patch({ title: 'b' })).status).toBe(404)
      expect(recordDirectRevision).not.toHaveBeenCalled()
    })
  })

  describe('DELETE', () => {
    it('returns 401 and 403', async () => {
      vi.mocked(authenticateAdmin).mockResolvedValue(null)
      expect((await del()).status).toBe(401)
      vi.mocked(authenticateAdmin).mockResolvedValue(admin)
      vi.mocked(hasScope).mockReturnValue(false)
      expect((await del()).status).toBe(403)
      expect(withTransaction).not.toHaveBeenCalled()
    })

    it('is blocked while someone else holds a draft', async () => {
      vi.mocked(draftsOf).mockResolvedValue([{ id: 'd1' }] as never)
      vi.mocked(discardGuard).mockResolvedValue(NextResponse.json({ error: 'held' }, { status: 423 }) as never)
      expect((await del()).status).toBe(423)
      expect(withTransaction).not.toHaveBeenCalled()
    })

    it('deletes items then the offer and closes the drafts', async () => {
      vi.mocked(draftsOf).mockResolvedValue([{ id: 'd1' }, { id: 'd2' }] as never)
      vi.mocked(discardGuard).mockResolvedValue(null as never)
      const client = { query: vi.fn() }
      vi.mocked(withTransaction).mockImplementation((async (fn: (c: unknown) => unknown) => fn(client)) as never)
      const res = await del()
      expect(await res.json()).toEqual({ success: true })
      expect(client.query.mock.calls.map(c => c[0])).toEqual([
        expect.stringMatching(/DELETE FROM product_offer_items/),
        expect.stringMatching(/DELETE FROM product_offers/),
      ])
      expect(client.query.mock.calls[1][1]).toEqual(['of1'])
      expect(closeIfLocked).toHaveBeenCalledTimes(2)
    })

    it('does not close drafts when the transaction fails', async () => {
      vi.mocked(draftsOf).mockResolvedValue([{ id: 'd1' }] as never)
      vi.mocked(discardGuard).mockResolvedValue(null as never)
      vi.mocked(withTransaction).mockRejectedValue(new Error('db'))
      await expect(del()).rejects.toThrow('db')
      expect(closeIfLocked).not.toHaveBeenCalled()
    })
  })
})
