import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/drive/access', () => ({ atLeast: vi.fn(), folderLevel: vi.fn() }))
vi.mock('@/lib/drive/listing', () => ({ fileFor: vi.fn(), moveFile: vi.fn(), renameFile: vi.fn(), trashFile: vi.fn() }))
vi.mock('@/lib/drive/files', () => ({ logDriveAccess: vi.fn(), toDriveFile: vi.fn() }))
vi.mock('@/lib/drive/http', () => ({ driveActor: vi.fn(), denied: vi.fn(), reqMeta: vi.fn() }))

import { GET, PATCH, DELETE } from '@admin/app/api/(admin)/admin/drive/files/[id]/route'
import { atLeast, folderLevel } from '@/lib/drive/access'
import { fileFor, moveFile, renameFile, trashFile } from '@/lib/drive/listing'
import { logDriveAccess, toDriveFile } from '@/lib/drive/files'
import { driveActor, denied, reqMeta } from '@/lib/drive/http'

const ACTOR = { adminId: 'a1', role: 'admin', scopes: [] }
const DEST = '44444444-4444-4444-8444-444444444444'
const ctx = { params: Promise.resolve({ id: 'file-1' }) }
const req = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/admin/drive/files/file-1', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(driveActor).mockResolvedValue(ACTOR as any)
  vi.mocked(denied).mockReturnValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
  vi.mocked(reqMeta).mockReturnValue({ ip: '1.1.1.1', userAgent: 'ua' } as any)
  vi.mocked(logDriveAccess).mockResolvedValue(undefined as any)
  vi.mocked(toDriveFile).mockImplementation((r: any) => ({ id: r.id, name: r.name }) as any)
  vi.mocked(fileFor).mockResolvedValue({ row: { id: 'file-1', name: 'a.png' }, level: 'manage' } as any)
  vi.mocked(atLeast).mockReturnValue(true)
})

describe('GET /api/admin/drive/files/[id]', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(driveActor).mockResolvedValueOnce(deny(401))
    expect((await GET(req('GET'), ctx)).status).toBe(401)
    vi.mocked(driveActor).mockResolvedValueOnce(deny(403))
    expect((await GET(req('GET'), ctx)).status).toBe(403)
    expect(driveActor).toHaveBeenCalledWith(expect.anything(), 'drive:read')
  })

  it('returns 404 when the file is not visible', async () => {
    vi.mocked(fileFor).mockResolvedValue(null as any)
    expect((await GET(req('GET'), ctx)).status).toBe(404)
  })

  it('returns the file with the access level', async () => {
    expect(await (await GET(req('GET'), ctx)).json()).toEqual({ file: { id: 'file-1', name: 'a.png', access: 'manage' } })
  })
})

describe('PATCH /api/admin/drive/files/[id]', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(driveActor).mockResolvedValueOnce(deny(401))
    expect((await PATCH(req('PATCH', {}), ctx)).status).toBe(401)
    vi.mocked(driveActor).mockResolvedValueOnce(deny(403))
    expect((await PATCH(req('PATCH', {}), ctx)).status).toBe(403)
    expect(driveActor).toHaveBeenCalledWith(expect.anything(), 'drive:write')
  })

  it('returns 400 for an invalid body', async () => {
    expect((await PATCH(req('PATCH', { folderId: 'not-a-uuid' }), ctx)).status).toBe(400)
    expect(renameFile).not.toHaveBeenCalled()
  })

  it('returns 404 when missing and 403 for view-only', async () => {
    vi.mocked(fileFor).mockResolvedValueOnce(null as any)
    expect((await PATCH(req('PATCH', { name: 'x' }), ctx)).status).toBe(404)
    vi.mocked(atLeast).mockReturnValue(false)
    expect((await PATCH(req('PATCH', { name: 'x' }), ctx)).status).toBe(403)
    expect(renameFile).not.toHaveBeenCalled()
  })

  it('renames and logs it', async () => {
    const res = await PATCH(req('PATCH', { name: 'b.png' }), ctx)
    expect(res.status).toBe(200)
    expect(renameFile).toHaveBeenCalledWith('file-1', 'b.png')
    expect(logDriveAccess).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'file-1', adminId: 'a1', action: 'rename' }))
    expect(moveFile).not.toHaveBeenCalled()
  })

  it('moves to a folder the actor can edit, and to the root', async () => {
    vi.mocked(folderLevel).mockResolvedValue('edit' as any)
    await PATCH(req('PATCH', { folderId: DEST }), ctx)
    expect(moveFile).toHaveBeenLastCalledWith('file-1', DEST)
    await PATCH(req('PATCH', { folderId: null }), ctx)
    expect(moveFile).toHaveBeenLastCalledWith('file-1', null)
    expect(logDriveAccess).toHaveBeenCalledWith(expect.objectContaining({ action: 'move' }))
  })

  it('returns 403 when the destination is not editable', async () => {
    vi.mocked(atLeast).mockReturnValueOnce(true).mockReturnValueOnce(false)
    expect((await PATCH(req('PATCH', { folderId: DEST }), ctx)).status).toBe(403)
    expect(moveFile).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/admin/drive/files/[id]', () => {
  it('rejects unauthenticated', async () => {
    vi.mocked(driveActor).mockResolvedValueOnce(deny(401))
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(401)
    expect(trashFile).not.toHaveBeenCalled()
  })

  it('returns 404 when missing and 403 for view-only', async () => {
    vi.mocked(fileFor).mockResolvedValueOnce(null as any)
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(404)
    vi.mocked(atLeast).mockReturnValue(false)
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(403)
    expect(trashFile).not.toHaveBeenCalled()
  })

  it('trashes the file and logs it', async () => {
    expect(await (await DELETE(req('DELETE'), ctx)).json()).toEqual({ success: true })
    expect(trashFile).toHaveBeenCalledWith('file-1')
    expect(logDriveAccess).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete' }))
  })
})
