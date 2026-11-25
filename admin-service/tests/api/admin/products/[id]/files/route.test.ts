import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/catalog/digital-guard', () => ({ canHoldVaultFiles: vi.fn() }))
vi.mock('@/lib/admin/draft-locks', () => ({
  actorOf: vi.fn(() => 'actor'),
  draftLockResponse: vi.fn(),
  epochFrom: vi.fn(() => 1),
  withDraftWrite: vi.fn(),
}))
vi.mock('@/lib/vault/files', () => {
  class VaultFileError extends Error {
    status: number
    constructor(m: string, status: number) {
      super(m)
      this.status = status
    }
  }
  return {
    VaultFileError,
    reserveUpload: vi.fn(),
    completeUpload: vi.fn(),
    listFiles: vi.fn(),
    setDownloadable: vi.fn(),
    deleteFile: vi.fn(),
  }
})

import { GET, POST, PATCH, DELETE } from '@admin/app/api/(admin)/admin/products/[id]/files/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { canHoldVaultFiles } from '@/lib/catalog/digital-guard'
import { draftLockResponse, withDraftWrite } from '@/lib/admin/draft-locks'
import * as vault from '@/lib/vault/files'

const admin = { adminId: 'a1', username: 'a', role: 'admin', scopes: [] }
const ctx = { params: Promise.resolve({ id: 'p1' }) }
const req = (method: string, qs = '', body?: unknown) =>
  new NextRequest(`http://localhost/x${qs}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })

describe('/api/admin/products/[id]/files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queryOne).mockReset()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue({ id: 'p1' })
    vi.mocked(canHoldVaultFiles).mockResolvedValue(true as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  describe('auth', () => {
    it.each([
      ['GET', () => GET(req('GET'), ctx), 'vault:read'],
      ['POST', () => POST(req('POST', '', {}), ctx), 'vault:write'],
      ['PATCH', () => PATCH(req('PATCH', '', {}), ctx), 'vault:write'],
      ['DELETE', () => DELETE(req('DELETE'), ctx), 'vault:write'],
    ])('%s returns 401 and 403 without %s', async (_m, run, scope) => {
      vi.mocked(authenticateAdmin).mockResolvedValue(null)
      expect((await run()).status).toBe(401)
      vi.mocked(authenticateAdmin).mockResolvedValue(admin)
      vi.mocked(hasScope).mockReturnValue(false)
      expect((await run()).status).toBe(403)
      expect(hasScope).toHaveBeenLastCalledWith('admin', [], scope)
    })
  })

  describe('GET', () => {
    it('returns 404 for an unknown product', async () => {
      vi.mocked(queryOne).mockResolvedValue(null)
      expect((await GET(req('GET'), ctx)).status).toBe(404)
    })

    it('lists the live files', async () => {
      vi.mocked(vault.listFiles).mockResolvedValue([{ id: 'f1' }] as never)
      const res = await GET(req('GET'), ctx)
      expect(await res.json()).toEqual({ files: [{ id: 'f1' }] })
      expect(vault.listFiles).toHaveBeenCalledWith('p1', null)
    })

    it('scopes the list to a draft and 404s an unknown draft', async () => {
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'p1' }).mockResolvedValueOnce({ id: 'd1' })
      vi.mocked(vault.listFiles).mockResolvedValue([] as never)
      await GET(req('GET', '?draft=d1'), ctx)
      expect(vault.listFiles).toHaveBeenCalledWith('p1', 'd1')
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'p1' }).mockResolvedValueOnce(null)
      expect((await GET(req('GET', '?draft=zz'), ctx)).status).toBe(404)
    })

    it('maps a VaultFileError to its status and others to 500', async () => {
      vi.mocked(vault.listFiles).mockRejectedValueOnce(new vault.VaultFileError('bad', 418))
      expect((await GET(req('GET'), ctx)).status).toBe(418)
      vi.mocked(vault.listFiles).mockRejectedValueOnce(new Error('x'))
      expect((await GET(req('GET'), ctx)).status).toBe(500)
    })
  })

  describe('POST', () => {
    it('returns 400 for invalid JSON, 404 for unknown product, 409 for non-digital', async () => {
      const bad = new NextRequest('http://localhost/x', { method: 'POST', body: 'nope' })
      expect((await POST(bad, ctx)).status).toBe(400)
      vi.mocked(queryOne).mockResolvedValue(null)
      expect((await POST(req('POST', '', { action: 'reserve' }), ctx)).status).toBe(404)
      vi.mocked(queryOne).mockResolvedValue({ id: 'p1' })
      vi.mocked(canHoldVaultFiles).mockResolvedValue(false as never)
      expect((await POST(req('POST', '', { action: 'reserve' }), ctx)).status).toBe(409)
    })

    it('reserves an upload and returns the signed target', async () => {
      vi.mocked(vault.reserveUpload).mockResolvedValue({
        sessionId: 's1', uploadUrl: 'https://u', storageKey: 'k', storageDriver: 's3', kind: 'document', mimeType: 'application/pdf',
      } as never)
      const res = await POST(req('POST', '', { action: 'reserve', display_name: 'a.pdf', mime_type: 'application/pdf', declared_bytes: '2048' }), ctx)
      expect(await res.json()).toEqual({
        session_id: 's1', upload_url: 'https://u', storage_key: 'k', storage_driver: 's3', kind: 'document', mime_type: 'application/pdf',
      })
      expect(vault.reserveUpload).toHaveBeenCalledWith({
        productId: 'p1', displayName: 'a.pdf', mimeType: 'application/pdf', declaredBytes: 2048, uploadedBy: 'a1',
      })
    })

    it('completes an upload, requiring session_id', async () => {
      expect((await POST(req('POST', '', { action: 'complete' }), ctx)).status).toBe(400)
      vi.mocked(vault.completeUpload).mockResolvedValue({ id: 'f1' } as never)
      const res = await POST(req('POST', '', { action: 'complete', session_id: 's1', downloadable: 1 }), ctx)
      expect(await res.json()).toEqual({ file: { id: 'f1' } })
      expect(vault.completeUpload).toHaveBeenCalledWith({ productId: 'p1', sessionId: 's1', downloadable: true, uploadedBy: 'a1', draftId: null })
    })

    it('returns 400 for an unknown action', async () => {
      expect((await POST(req('POST', '', { action: 'zap' }), ctx)).status).toBe(400)
    })

    it('returns the lock response for a locked draft and stages into an unlocked one', async () => {
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'p1' }).mockResolvedValueOnce({ id: 'd1' })
      vi.mocked(withDraftWrite).mockRejectedValueOnce(new Error('locked'))
      vi.mocked(draftLockResponse).mockReturnValueOnce(NextResponse.json({ error: 'locked' }, { status: 423 }) as never)
      expect((await POST(req('POST', '?draft=d1', { action: 'complete', session_id: 's' }), ctx)).status).toBe(423)
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'p1' }).mockResolvedValueOnce({ id: 'd1' })
      vi.mocked(withDraftWrite).mockResolvedValueOnce(undefined as never)
      vi.mocked(vault.completeUpload).mockResolvedValue({ id: 'f' } as never)
      await POST(req('POST', '?draft=d1', { action: 'complete', session_id: 's' }), ctx)
      expect(vault.completeUpload).toHaveBeenCalledWith(expect.objectContaining({ draftId: 'd1' }))
    })
  })

  describe('PATCH', () => {
    it('returns 400 without file_id', async () => {
      expect((await PATCH(req('PATCH', '', {}), ctx)).status).toBe(400)
    })

    it('toggles downloadable, 404 when the file is unknown', async () => {
      vi.mocked(vault.setDownloadable).mockResolvedValueOnce(true as never)
      expect(await (await PATCH(req('PATCH', '', { file_id: 'f1', downloadable: true }), ctx)).json()).toEqual({ ok: true })
      expect(vault.setDownloadable).toHaveBeenCalledWith('p1', 'f1', true, null)
      vi.mocked(vault.setDownloadable).mockResolvedValueOnce(false as never)
      expect((await PATCH(req('PATCH', '', { file_id: 'zz' }), ctx)).status).toBe(404)
    })
  })

  describe('DELETE', () => {
    it('returns 400 without file_id', async () => {
      expect((await DELETE(req('DELETE'), ctx)).status).toBe(400)
    })

    it('deletes the file, 404 when unknown, 500 on failure', async () => {
      vi.mocked(vault.deleteFile).mockResolvedValueOnce(true as never)
      expect((await DELETE(req('DELETE', '?file_id=f1'), ctx)).status).toBe(200)
      expect(vault.deleteFile).toHaveBeenCalledWith('p1', 'f1', null)
      vi.mocked(vault.deleteFile).mockResolvedValueOnce(false as never)
      expect((await DELETE(req('DELETE', '?file_id=f1'), ctx)).status).toBe(404)
      vi.mocked(vault.deleteFile).mockRejectedValueOnce(new Error('x'))
      expect((await DELETE(req('DELETE', '?file_id=f1'), ctx)).status).toBe(500)
    })
  })
})
