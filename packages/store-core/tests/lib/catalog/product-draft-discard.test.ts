import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/shared/s3', () => ({ deleteProductImage: vi.fn() }))
vi.mock('@/lib/vault/files', () => ({ discardDraftFiles: vi.fn() }))
vi.mock('@/lib/admin/draft-locks', () => ({ closeAfter: vi.fn() }))
vi.mock('@/lib/admin/discard-rows', () => ({
  discardRefusal: vi.fn(),
  discarded: { ok: true },
  refused: (status: number, error: string) => ({ ok: false, status, body: { error } }),
}))

import { closeProductSessions, discardProductDraft } from '@/lib/catalog/product-draft-discard'
import { query, queryOne } from '@/lib/shared/db'
import { deleteProductImage } from '@/lib/shared/s3'
import { discardDraftFiles } from '@/lib/vault/files'
import { closeAfter } from '@/lib/admin/draft-locks'
import { discardRefusal } from '@/lib/admin/discard-rows'

const mQuery = vi.mocked(query)
const mQueryOne = vi.mocked(queryOne)
const mDelImg = vi.mocked(deleteProductImage)
const mDiscardFiles = vi.mocked(discardDraftFiles)
const mCloseAfter = vi.mocked(closeAfter)
const mRefusal = vi.mocked(discardRefusal)

const actor = { adminId: 'a1' }

beforeEach(() => {
  vi.clearAllMocks()
  mQuery.mockResolvedValue({} as any)
  mDelImg.mockResolvedValue(undefined as any)
  mDiscardFiles.mockResolvedValue(undefined as any)
})

describe('closeProductSessions', () => {
  it('closes open editor sessions for the draft', async () => {
    await closeProductSessions('d1')
    const [sql, args] = mQuery.mock.calls[0]
    expect(String(sql)).toContain('UPDATE editor_sessions SET closed_at = now()')
    expect(String(sql)).toContain("closed_reason = 'save'")
    expect(args).toEqual(['d1'])
  })

  it('swallows and logs a DB error', async () => {
    const err = new Error('boom')
    mQuery.mockRejectedValueOnce(err)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(closeProductSessions('d1')).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledWith('[product-draft] closing edit sessions failed for', 'd1', err)
    spy.mockRestore()
  })
})

describe('discardProductDraft', () => {
  it('returns the refusal when discard is denied', async () => {
    const denied = { ok: false, status: 423, body: { error: 'locked' } }
    mRefusal.mockResolvedValueOnce(denied as any)
    const r = await discardProductDraft(actor, 'id1', 'd1')
    expect(r).toBe(denied)
    expect(mRefusal).toHaveBeenCalledWith(actor, 'product', 'd1')
    expect(mQueryOne).not.toHaveBeenCalled()
  })

  it('uses the product id for the refusal when there is no draftId', async () => {
    mRefusal.mockResolvedValueOnce(null)
    mQueryOne.mockResolvedValueOnce(null) // no create-draft product
    await discardProductDraft(actor, 'id1', null)
    expect(mRefusal).toHaveBeenCalledWith(actor, 'product', 'id1')
  })

  describe('no edit draft (create-draft path)', () => {
    it('deletes the never-published product row and closes', async () => {
      mRefusal.mockResolvedValueOnce(null)
      mQueryOne.mockResolvedValueOnce({ id: 'id1' }) // is_draft product found
      const r = await discardProductDraft(actor, 'id1', null)
      expect(r).toEqual({ ok: true })
      const del = mQuery.mock.calls.find(c => String(c[0]).includes('DELETE FROM products'))
      expect(del).toBeDefined()
      expect(String(del![0])).toContain('is_draft = true')
      expect(del![1]).toEqual(['id1'])
      expect(mCloseAfter).toHaveBeenCalledWith(actor, 'product', 'id1', 'discarded')
    })

    it('refuses 404 when there is no create-draft product', async () => {
      mRefusal.mockResolvedValueOnce(null)
      mQueryOne.mockResolvedValueOnce(null)
      const r = await discardProductDraft(actor, 'id1', null)
      expect(r).toEqual({ ok: false, status: 404, body: { error: 'Draft not found' } })
      expect(mCloseAfter).not.toHaveBeenCalled()
    })
  })

  describe('edit-draft path', () => {
    it('cleans staged variant/product images, discards files, deletes the draft, closes sessions', async () => {
      mRefusal.mockResolvedValueOnce(null)
      mQueryOne.mockResolvedValueOnce({
        variant_images: [
          { _staged: true, s3_key: 'k1', s3_thumbnail_key: 't1', id: 'draft-vi-1' },
          { _staged: true, s3_key: 'k2', id: 'draft-vi-2' }, // no thumb -> ''
          { _staged: true, s3_key: 'k3', id: 'real-uuid' }, // not draft-vi prefixed -> skip
          { _staged: false, s3_key: 'k4', id: 'draft-vi-4' }, // not staged -> skip
        ],
        images: [
          { _staged: true, s3_key: 'i1', s3_thumbnail_key: 'it1', id: 'draft-img-1' },
          { _staged: true, s3_key: 'i2', id: 'live-uuid' }, // skip
        ],
      })
      const r = await discardProductDraft(actor, 'id1', 'd1')
      expect(r).toEqual({ ok: true })
      // only the two staged draft-prefixed images deleted
      expect(mDelImg).toHaveBeenCalledTimes(3)
      expect(mDelImg).toHaveBeenCalledWith('k1', 't1')
      expect(mDelImg).toHaveBeenCalledWith('k2', '')
      expect(mDelImg).toHaveBeenCalledWith('i1', 'it1')
      expect(mDiscardFiles).toHaveBeenCalledWith('d1')
      const del = mQuery.mock.calls.find(c => String(c[0]).includes('DELETE FROM product_drafts'))
      expect(del![1]).toEqual(['d1'])
      // closes sessions (UPDATE editor_sessions) and closeAfter
      expect(mQuery.mock.calls.some(c => String(c[0]).includes('editor_sessions'))).toBe(true)
      expect(mCloseAfter).toHaveBeenCalledWith(actor, 'product', 'd1', 'discarded')
    })

    it('handles a draft with non-array image fields', async () => {
      mRefusal.mockResolvedValueOnce(null)
      mQueryOne.mockResolvedValueOnce({ variant_images: null, images: undefined })
      const r = await discardProductDraft(actor, 'id1', 'd1')
      expect(r).toEqual({ ok: true })
      expect(mDelImg).not.toHaveBeenCalled()
      expect(mDiscardFiles).toHaveBeenCalledWith('d1')
    })

    it('swallows an S3 cleanup error for a staged image', async () => {
      mRefusal.mockResolvedValueOnce(null)
      mQueryOne.mockResolvedValueOnce({
        variant_images: [{ _staged: true, s3_key: 'k1', id: 'draft-vi-1' }],
        images: [],
      })
      mDelImg.mockRejectedValueOnce(new Error('s3 down'))
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const r = await discardProductDraft(actor, 'id1', 'd1')
      expect(r).toEqual({ ok: true })
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })
  })
})
