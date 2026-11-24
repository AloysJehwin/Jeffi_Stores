import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))
vi.mock('@/lib/drive/http', () => ({ driveActor: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/drive/people/route'
import { queryMany } from '@/lib/shared/db'
import { driveActor } from '@/lib/drive/http'

const req = () => new NextRequest('http://localhost/api/admin/drive/people')
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(driveActor).mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: [] } as any)
})

describe('GET /api/admin/drive/people', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(driveActor).mockResolvedValueOnce(deny(401))
    expect((await GET(req())).status).toBe(401)
    vi.mocked(driveActor).mockResolvedValueOnce(deny(403))
    expect((await GET(req())).status).toBe(403)
    expect(driveActor).toHaveBeenCalledWith(expect.anything(), 'drive:write')
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('lists other staff and the distinct sorted roles', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { id: 'a1', name: 'Me', email: 'me@x.test', role: 'admin' },
      { id: 'a2', name: 'Bo', email: 'bo@x.test', role: 'support' },
      { id: 'a3', name: 'Cy', email: 'cy@x.test', role: 'admin' },
    ] as any)
    const body = await (await GET(req())).json()
    expect(body.admins.map((a: any) => a.id)).toEqual(['a2', 'a3'])
    expect(body.roles).toEqual(['admin', 'support'])
  })

  it('propagates a db failure', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('db'))
    await expect(GET(req())).rejects.toThrow('db')
  })
})
