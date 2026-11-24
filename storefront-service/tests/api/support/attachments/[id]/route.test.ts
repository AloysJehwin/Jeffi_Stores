import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateAdmin = vi.hoisted(() => vi.fn())
const authenticateAnyUser = vi.hoisted(() => vi.fn())
const hasScope = vi.hoisted(() => vi.fn())
const queryOne = vi.hoisted(() => vi.fn())
const getFileRow = vi.hoisted(() => vi.fn())
const logDriveAccess = vi.hoisted(() => vi.fn())
const signFile = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin, authenticateAnyUser }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope }))
vi.mock('@/lib/shared/db', () => ({ queryOne }))
vi.mock('@/lib/drive/files', () => ({ getFileRow, logDriveAccess, signFile }))

import { GET } from '@storefront/app/api/(public)/support/attachments/[id]/route'

const get = (qs = '') =>
  GET(new NextRequest(`http://localhost/api/support/attachments/att1${qs}`, { headers: { 'x-forwarded-for': '1.2.3.4', 'user-agent': 'UA' } }), {
    params: Promise.resolve({ id: 'att1' }),
  })

describe('GET /api/support/attachments/[id]', () => {
  beforeEach(() => {
    queryOne.mockResolvedValue({ drive_file_id: 'f1', user_id: 'u1' })
    authenticateAdmin.mockResolvedValue(null)
    authenticateAnyUser.mockResolvedValue({ userId: 'u1' })
    hasScope.mockReturnValue(true)
    getFileRow.mockResolvedValue({ id: 'f1' })
    signFile.mockResolvedValue('/signed/f1?sig=abc')
    logDriveAccess.mockResolvedValue(undefined)
  })

  it('404s an unknown attachment or one without a stored file (and when the lookup fails)', async () => {
    queryOne.mockResolvedValue(null)
    expect((await get()).status).toBe(404)
    queryOne.mockResolvedValue({ drive_file_id: null, user_id: 'u1' })
    expect((await get()).status).toBe(404)
    queryOne.mockRejectedValue(new Error('db'))
    expect((await get()).status).toBe(404)
  })

  it('404s for a user who does not own the chat, signing nothing', async () => {
    authenticateAnyUser.mockResolvedValue({ userId: 'someone-else' })
    expect((await get()).status).toBe(404)
    authenticateAnyUser.mockResolvedValue(null)
    expect((await get()).status).toBe(404)
    expect(signFile).not.toHaveBeenCalled()
  })

  it('404s an admin without customer read scope (falls through to the user check)', async () => {
    authenticateAdmin.mockResolvedValue({ role: 'staff', scopes: [], adminId: 'a1' })
    hasScope.mockReturnValue(false)
    authenticateAnyUser.mockResolvedValue(null)
    expect((await get()).status).toBe(404)
  })

  it('redirects the chat owner to a short-lived signed link and logs the view', async () => {
    const res = await get()
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost/signed/f1?sig=abc')
    expect(res.headers.get('cache-control')).toBe('private, max-age=60')
    expect(signFile).toHaveBeenCalledWith({ id: 'f1' }, { thumb: false, download: false })
    expect(logDriveAccess).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'f1', adminId: null, userId: 'u1', action: 'view', ip: '1.2.3.4', userAgent: 'UA' })
    )
  })

  it('lets a staff admin with customers:read download it', async () => {
    authenticateAdmin.mockResolvedValue({ role: 'staff', scopes: ['customers:read'], adminId: 'a1' })
    const res = await get('?download=1')
    expect(res.status).toBe(302)
    expect(signFile).toHaveBeenCalledWith({ id: 'f1' }, { thumb: false, download: true })
    expect(logDriveAccess).toHaveBeenCalledWith(expect.objectContaining({ adminId: 'a1', userId: null, action: 'download' }))
  })

  it('does not log thumbnail fetches', async () => {
    await get('?thumb=1')
    expect(signFile).toHaveBeenCalledWith({ id: 'f1' }, { thumb: true, download: false })
    expect(logDriveAccess).not.toHaveBeenCalled()
  })

  it('404s when the stored file row is gone', async () => {
    getFileRow.mockResolvedValue(null)
    expect((await get()).status).toBe(404)
  })
})
