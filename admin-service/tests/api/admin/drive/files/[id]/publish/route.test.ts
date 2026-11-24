import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/drive/listing', () => ({ fileFor: vi.fn() }))
vi.mock('@/lib/drive/gallery', () => ({ publishToGallery: vi.fn() }))
vi.mock('@/lib/drive/files', () => ({ logDriveAccess: vi.fn() }))
vi.mock('@/lib/drive/http', () => ({ driveActor: vi.fn(), driveFailure: vi.fn(), denied: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/drive/files/[id]/publish/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { fileFor } from '@/lib/drive/listing'
import { publishToGallery } from '@/lib/drive/gallery'
import { logDriveAccess } from '@/lib/drive/files'
import { driveActor, driveFailure, denied } from '@/lib/drive/http'

const ctx = { params: Promise.resolve({ id: 'file-1' }) }
const req = () => new NextRequest('http://localhost/api/admin/drive/files/file-1/publish', { method: 'POST' })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })
const row = { id: 'file-1' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(driveActor).mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: [] } as any)
  vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: [] } as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(denied).mockReturnValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
  vi.mocked(driveFailure).mockReturnValue(NextResponse.json({ error: 'Publishing failed' }, { status: 500 }))
  vi.mocked(logDriveAccess).mockResolvedValue(undefined as any)
  vi.mocked(fileFor).mockResolvedValue({ row, level: 'manage' } as any)
})

describe('POST /api/admin/drive/files/[id]/publish', () => {
  it('rejects unauthenticated and missing drive scope', async () => {
    vi.mocked(driveActor).mockResolvedValueOnce(deny(401))
    expect((await POST(req(), ctx)).status).toBe(401)
    vi.mocked(driveActor).mockResolvedValueOnce(deny(403))
    expect((await POST(req(), ctx)).status).toBe(403)
    expect(driveActor).toHaveBeenCalledWith(expect.anything(), 'drive:write')
  })

  it('returns 403 when the admin has no gallery-capable scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req(), ctx)).status).toBe(403)
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req(), ctx)).status).toBe(403)
    expect(publishToGallery).not.toHaveBeenCalled()
  })

  it('returns 404 when the file is not visible', async () => {
    vi.mocked(fileFor).mockResolvedValue(null as any)
    expect((await POST(req(), ctx)).status).toBe(404)
  })

  it('copies the file to the gallery and logs a share', async () => {
    vi.mocked(publishToGallery).mockResolvedValue({ gallery: { id: 'g1', url: 'u' } } as any)
    expect(await (await POST(req(), ctx)).json()).toEqual({ gallery: { id: 'g1', url: 'u' } })
    expect(publishToGallery).toHaveBeenCalledWith(row, 'a1')
    expect(logDriveAccess).toHaveBeenCalledWith({ fileId: 'file-1', adminId: 'a1', action: 'share' })
  })

  it('maps a storage failure through driveFailure', async () => {
    vi.mocked(publishToGallery).mockRejectedValue(new Error('s3'))
    expect((await POST(req(), ctx)).status).toBe(500)
    expect(driveFailure).toHaveBeenCalledWith(expect.any(Error), 'Publishing')
    expect(logDriveAccess).not.toHaveBeenCalled()
  })
})
