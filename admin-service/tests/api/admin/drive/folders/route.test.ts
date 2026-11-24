import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/drive/access', () => ({ atLeast: vi.fn(), folderLevel: vi.fn() }))
vi.mock('@/lib/drive/folders', () => ({ createFolder: vi.fn() }))
vi.mock('@/lib/drive/http', () => ({ driveActor: vi.fn(), driveFailure: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/drive/folders/route'
import { atLeast, folderLevel } from '@/lib/drive/access'
import { createFolder } from '@/lib/drive/folders'
import { driveActor, driveFailure } from '@/lib/drive/http'

const ACTOR = { adminId: 'a1', role: 'admin', scopes: [] }
const PARENT = '11111111-1111-4111-8111-111111111111'
const req = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/drive/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(driveActor).mockResolvedValue(ACTOR as any)
  vi.mocked(atLeast).mockReturnValue(true)
  vi.mocked(folderLevel).mockResolvedValue('manage' as any)
  vi.mocked(driveFailure).mockReturnValue(NextResponse.json({ error: 'Creating the folder failed' }, { status: 500 }))
})

describe('POST /api/admin/drive/folders', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(driveActor).mockResolvedValueOnce(deny(401))
    expect((await POST(req({ name: 'x' }))).status).toBe(401)
    vi.mocked(driveActor).mockResolvedValueOnce(deny(403))
    expect((await POST(req({ name: 'x' }))).status).toBe(403)
    expect(driveActor).toHaveBeenCalledWith(expect.anything(), 'drive:write')
  })

  it('returns 400 for a missing name', async () => {
    expect((await POST(req({ name: '  ' }))).status).toBe(400)
    expect(createFolder).not.toHaveBeenCalled()
  })

  it('creates a private root folder by default', async () => {
    vi.mocked(createFolder).mockResolvedValue({ id: 'f1' } as any)
    expect(await (await POST(req({ name: 'Docs' }))).json()).toEqual({ folder: { id: 'f1' } })
    expect(createFolder).toHaveBeenCalledWith(ACTOR, { parentId: null, name: 'Docs', visibility: 'private' })
  })

  it('returns 403 without edit access on the parent', async () => {
    vi.mocked(atLeast).mockReturnValue(false)
    expect((await POST(req({ name: 'Docs', parentId: PARENT }))).status).toBe(403)
    expect(folderLevel).toHaveBeenCalledWith(ACTOR, PARENT)
    expect(createFolder).not.toHaveBeenCalled()
  })

  it('creates a nested folder', async () => {
    vi.mocked(createFolder).mockResolvedValue({ id: 'f2' } as any)
    await POST(req({ name: 'Sub', parentId: PARENT, visibility: 'team' }))
    expect(createFolder).toHaveBeenCalledWith(ACTOR, { parentId: PARENT, name: 'Sub', visibility: 'team' })
  })

  it('maps a storage failure through driveFailure', async () => {
    const err = new Error('s3')
    vi.mocked(createFolder).mockRejectedValue(err)
    expect((await POST(req({ name: 'Docs' }))).status).toBe(500)
    expect(driveFailure).toHaveBeenCalledWith(err, 'Creating the folder')
  })
})
