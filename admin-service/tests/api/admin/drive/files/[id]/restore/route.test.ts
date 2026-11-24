import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/drive/access', () => ({ atLeast: vi.fn() }))
vi.mock('@/lib/drive/listing', () => ({ fileFor: vi.fn(), restoreFile: vi.fn() }))
vi.mock('@/lib/drive/files', () => ({ logDriveAccess: vi.fn() }))
vi.mock('@/lib/drive/http', () => ({ driveActor: vi.fn(), denied: vi.fn(), reqMeta: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/drive/files/[id]/restore/route'
import { atLeast } from '@/lib/drive/access'
import { fileFor, restoreFile } from '@/lib/drive/listing'
import { logDriveAccess } from '@/lib/drive/files'
import { driveActor, denied, reqMeta } from '@/lib/drive/http'

const ctx = { params: Promise.resolve({ id: 'file-1' }) }
const req = () => new NextRequest('http://localhost/api/admin/drive/files/file-1/restore', { method: 'POST' })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })
const trashed = (uploader = 'a9') => ({ row: { id: 'file-1', deleted_at: '2026-01-01', uploaded_by_admin_id: uploader }, level: 'view' })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(driveActor).mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: [] } as any)
  vi.mocked(denied).mockReturnValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
  vi.mocked(reqMeta).mockReturnValue({} as any)
  vi.mocked(logDriveAccess).mockResolvedValue(undefined as any)
  vi.mocked(atLeast).mockReturnValue(true)
  vi.mocked(fileFor).mockResolvedValue(trashed() as any)
})

describe('POST /api/admin/drive/files/[id]/restore', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(driveActor).mockResolvedValueOnce(deny(401))
    expect((await POST(req(), ctx)).status).toBe(401)
    vi.mocked(driveActor).mockResolvedValueOnce(deny(403))
    expect((await POST(req(), ctx)).status).toBe(403)
    expect(driveActor).toHaveBeenCalledWith(expect.anything(), 'drive:write')
  })

  it('returns 404 for a missing or not-deleted file', async () => {
    vi.mocked(fileFor).mockResolvedValueOnce(null as any)
    expect((await POST(req(), ctx)).status).toBe(404)
    vi.mocked(fileFor).mockResolvedValueOnce({ row: { id: 'file-1', deleted_at: null }, level: 'manage' } as any)
    expect((await POST(req(), ctx)).status).toBe(404)
    expect(restoreFile).not.toHaveBeenCalled()
  })

  it('returns 403 when the actor can neither edit nor owns the file', async () => {
    vi.mocked(atLeast).mockReturnValue(false)
    expect((await POST(req(), ctx)).status).toBe(403)
    expect(restoreFile).not.toHaveBeenCalled()
  })

  it('restores for an editor and logs it', async () => {
    expect(await (await POST(req(), ctx)).json()).toEqual({ success: true })
    expect(fileFor).toHaveBeenCalledWith(expect.anything(), 'file-1', { withDeleted: true })
    expect(restoreFile).toHaveBeenCalledWith('file-1')
    expect(logDriveAccess).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'file-1', adminId: 'a1', action: 'restore' }))
  })

  it('restores for the uploader even without edit access', async () => {
    vi.mocked(atLeast).mockReturnValue(false)
    vi.mocked(fileFor).mockResolvedValue(trashed('a1') as any)
    expect((await POST(req(), ctx)).status).toBe(200)
    expect(restoreFile).toHaveBeenCalledWith('file-1')
  })
})
