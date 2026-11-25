import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/drive/access', () => ({ atLeast: vi.fn(), folderLevel: vi.fn() }))
vi.mock('@/lib/drive/folders', () => ({ getFolder: vi.fn(), isWithin: vi.fn(), trashFolder: vi.fn(), updateFolder: vi.fn() }))
vi.mock('@/lib/drive/http', () => ({ driveActor: vi.fn(), driveFailure: vi.fn(), denied: vi.fn() }))
vi.mock('@/lib/drive/files', () => ({ logDriveAccess: vi.fn() }))

import { PATCH, DELETE } from '@admin/app/api/(admin)/admin/drive/folders/[id]/route'
import { atLeast, folderLevel } from '@/lib/drive/access'
import { getFolder, isWithin, trashFolder, updateFolder } from '@/lib/drive/folders'
import { driveActor, driveFailure, denied } from '@/lib/drive/http'
import { logDriveAccess } from '@/lib/drive/files'

const ACTOR = { adminId: 'a1', role: 'admin', scopes: [] }
const ID = '22222222-2222-4222-8222-222222222222'
const PARENT = '11111111-1111-4111-8111-111111111111'
const ctx = { params: Promise.resolve({ id: ID }) }
const req = (method: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/admin/drive/folders/${ID}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(driveActor).mockResolvedValue(ACTOR as any)
  vi.mocked(denied).mockReturnValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
  vi.mocked(driveFailure).mockReturnValue(NextResponse.json({ error: 'failed' }, { status: 500 }))
  vi.mocked(logDriveAccess).mockResolvedValue(undefined as any)
  vi.mocked(getFolder).mockResolvedValue({ id: ID, access: 'manage', systemKey: null } as any)
  vi.mocked(atLeast).mockReturnValue(true)
  vi.mocked(isWithin).mockResolvedValue(false as any)
})

describe('PATCH /api/admin/drive/folders/[id]', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(driveActor).mockResolvedValueOnce(deny(401))
    expect((await PATCH(req('PATCH', {}), ctx)).status).toBe(401)
    vi.mocked(driveActor).mockResolvedValueOnce(deny(403))
    expect((await PATCH(req('PATCH', {}), ctx)).status).toBe(403)
    expect(driveActor).toHaveBeenCalledWith(expect.anything(), 'drive:write')
  })

  it('returns 400 for an invalid body', async () => {
    expect((await PATCH(req('PATCH', { visibility: 'public' }), ctx)).status).toBe(400)
    expect(updateFolder).not.toHaveBeenCalled()
  })

  it('returns 404 when the folder is not visible', async () => {
    vi.mocked(getFolder).mockResolvedValue(null as any)
    expect((await PATCH(req('PATCH', { name: 'x' }), ctx)).status).toBe(404)
  })

  it('returns 403 for a non-manager and 400 for a system folder', async () => {
    vi.mocked(getFolder).mockResolvedValueOnce({ id: ID, access: 'edit' } as any)
    expect((await PATCH(req('PATCH', { name: 'x' }), ctx)).status).toBe(403)
    vi.mocked(getFolder).mockResolvedValueOnce({ id: ID, access: 'manage', systemKey: 'gallery' } as any)
    expect((await PATCH(req('PATCH', { name: 'x' }), ctx)).status).toBe(400)
    expect(updateFolder).not.toHaveBeenCalled()
  })

  it('refuses to move a folder inside itself or without edit on the target', async () => {
    vi.mocked(isWithin).mockResolvedValueOnce(true as any)
    expect((await PATCH(req('PATCH', { parentId: PARENT }), ctx)).status).toBe(400)
    vi.mocked(atLeast).mockReturnValue(false)
    expect((await PATCH(req('PATCH', { parentId: PARENT }), ctx)).status).toBe(403)
    expect(folderLevel).toHaveBeenCalledWith(ACTOR, PARENT)
    expect(updateFolder).not.toHaveBeenCalled()
  })

  it('renames and logs a rename', async () => {
    expect((await PATCH(req('PATCH', { name: 'New' }), ctx)).status).toBe(200)
    expect(updateFolder).toHaveBeenCalledWith(ID, { name: 'New' })
    expect(logDriveAccess).toHaveBeenCalledWith({ folderId: ID, adminId: 'a1', action: 'rename' })
  })

  it('moves and logs a move', async () => {
    await PATCH(req('PATCH', { parentId: PARENT }), ctx)
    expect(updateFolder).toHaveBeenCalledWith(ID, { parentId: PARENT })
    expect(logDriveAccess).toHaveBeenCalledWith({ folderId: ID, adminId: 'a1', action: 'move' })
  })

  it('maps a storage failure through driveFailure', async () => {
    vi.mocked(updateFolder).mockRejectedValue(new Error('db'))
    expect((await PATCH(req('PATCH', { name: 'x' }), ctx)).status).toBe(500)
    expect(driveFailure).toHaveBeenCalledWith(expect.any(Error), 'Updating the folder')
  })
})

describe('DELETE /api/admin/drive/folders/[id]', () => {
  it('rejects unauthenticated', async () => {
    vi.mocked(driveActor).mockResolvedValueOnce(deny(401))
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(401)
    expect(trashFolder).not.toHaveBeenCalled()
  })

  it('returns 404 when missing and 403 for a non-manager', async () => {
    vi.mocked(getFolder).mockResolvedValueOnce(null as any)
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(404)
    vi.mocked(getFolder).mockResolvedValueOnce({ id: ID, access: 'edit' } as any)
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(403)
  })

  it('returns 400 for a system folder', async () => {
    vi.mocked(trashFolder).mockResolvedValue(false as any)
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(400)
    expect(logDriveAccess).not.toHaveBeenCalled()
  })

  it('trashes the folder and logs it', async () => {
    vi.mocked(trashFolder).mockResolvedValue(true as any)
    expect(await (await DELETE(req('DELETE'), ctx)).json()).toEqual({ success: true })
    expect(trashFolder).toHaveBeenCalledWith(ID)
    expect(logDriveAccess).toHaveBeenCalledWith({ folderId: ID, adminId: 'a1', action: 'delete' })
  })
})
