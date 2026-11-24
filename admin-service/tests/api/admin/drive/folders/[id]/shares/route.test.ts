import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/drive/folders', () => ({ getFolder: vi.fn(), listShares: vi.fn(), addShare: vi.fn(), removeShare: vi.fn() }))
vi.mock('@/lib/drive/http', () => ({ driveActor: vi.fn(), denied: vi.fn() }))
vi.mock('@/lib/drive/files', () => ({ logDriveAccess: vi.fn() }))

import { GET, POST, DELETE } from '@admin/app/api/(admin)/admin/drive/folders/[id]/shares/route'
import { queryOne } from '@/lib/shared/db'
import { getFolder, listShares, addShare, removeShare } from '@/lib/drive/folders'
import { driveActor, denied } from '@/lib/drive/http'
import { logDriveAccess } from '@/lib/drive/files'

const ACTOR = { adminId: 'a1', role: 'admin', scopes: [] }
const ID = 'f-1'
const PERSON = '33333333-3333-4333-8333-333333333333'
const ctx = { params: Promise.resolve({ id: ID }) }
const req = (method: string, body?: unknown, qs = '') =>
  new NextRequest(`http://localhost/api/admin/drive/folders/${ID}/shares${qs}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body) })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(driveActor).mockResolvedValue(ACTOR as any)
  vi.mocked(denied).mockReturnValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
  vi.mocked(getFolder).mockResolvedValue({ id: ID, access: 'manage' } as any)
  vi.mocked(listShares).mockResolvedValue([{ id: 's1' }] as any)
  vi.mocked(logDriveAccess).mockResolvedValue(undefined as any)
})

describe('access gate (all methods)', () => {
  it.each([
    ['GET', GET],
    ['POST', POST],
    ['DELETE', DELETE],
  ] as const)('%s rejects unauthenticated, missing scope, unknown folder and non-owners', async (m, fn) => {
    vi.mocked(driveActor).mockResolvedValueOnce(deny(401))
    expect((await fn(req(m, {}), ctx)).status).toBe(401)
    vi.mocked(driveActor).mockResolvedValueOnce(deny(403))
    expect((await fn(req(m, {}), ctx)).status).toBe(403)
    expect(driveActor).toHaveBeenCalledWith(expect.anything(), 'drive:write')
    vi.mocked(getFolder).mockResolvedValueOnce(null as any)
    expect((await fn(req(m, {}), ctx)).status).toBe(404)
    vi.mocked(getFolder).mockResolvedValueOnce({ id: ID, access: 'edit' } as any)
    expect((await fn(req(m, {}), ctx)).status).toBe(403)
    expect(addShare).not.toHaveBeenCalled()
    expect(removeShare).not.toHaveBeenCalled()
  })
})

describe('GET shares', () => {
  it('lists the folder shares', async () => {
    expect(await (await GET(req('GET'), ctx)).json()).toEqual({ shares: [{ id: 's1' }] })
    expect(listShares).toHaveBeenCalledWith({ folderId: ID })
  })
})

describe('POST shares', () => {
  it('returns 400 unless exactly one of person or role is given', async () => {
    expect((await POST(req('POST', { level: 'view' }), ctx)).status).toBe(400)
    expect((await POST(req('POST', { level: 'view', adminId: PERSON, role: 'support' }), ctx)).status).toBe(400)
    expect(addShare).not.toHaveBeenCalled()
  })

  it('shares with a person and logs it', async () => {
    const res = await POST(req('POST', { level: 'edit', adminId: PERSON }), ctx)
    expect(await res.json()).toEqual({ shares: [{ id: 's1' }] })
    expect(addShare).toHaveBeenCalledWith({ folderId: ID }, { adminId: PERSON, role: undefined }, 'edit', 'a1')
    expect(logDriveAccess).toHaveBeenCalledWith({ folderId: ID, adminId: 'a1', action: 'share' })
  })

  it('shares with a role', async () => {
    await POST(req('POST', { level: 'view', role: 'support' }), ctx)
    expect(addShare).toHaveBeenCalledWith({ folderId: ID }, { adminId: undefined, role: 'support' }, 'view', 'a1')
  })
})

describe('DELETE shares', () => {
  it('returns 404 for a share on another folder or an unknown share', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ folder_id: 'other' } as any)
    expect((await DELETE(req('DELETE', undefined, '?shareId=s1'), ctx)).status).toBe(404)
    vi.mocked(queryOne).mockRejectedValueOnce(new Error('db'))
    expect((await DELETE(req('DELETE', undefined, '?shareId=s2'), ctx)).status).toBe(404)
    expect(removeShare).not.toHaveBeenCalled()
  })

  it('removes the share and returns the remaining list', async () => {
    vi.mocked(queryOne).mockResolvedValue({ folder_id: ID } as any)
    expect(await (await DELETE(req('DELETE', undefined, '?shareId=s1'), ctx)).json()).toEqual({ shares: [{ id: 's1' }] })
    expect(removeShare).toHaveBeenCalledWith('s1')
  })
})
