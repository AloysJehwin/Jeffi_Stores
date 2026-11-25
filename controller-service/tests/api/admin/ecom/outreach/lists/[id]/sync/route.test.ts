import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ sync: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/import', () => ({
  syncSheetList: m.sync,
  ImportError: class ImportError extends Error {
    constructor(message: string, public status = 400) {
      super(message)
    }
  },
}))

import { POST } from '@controller/app/api/(admin)/admin/ecom/outreach/lists/[id]/sync/route'
import { ImportError } from '@controller/lib/outreach/import'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const ID = '33333333-3333-3333-3333-333333333333'
const call = (id = ID) => POST(new NextRequest('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
  m.sync.mockResolvedValue({ list: { id: ID }, summary: { inserted: 1 } })
})

describe('/api/admin/ecom/outreach/lists/[id]/sync', () => {
  it('401 / 403 gates', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await call()).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await call()).status).toBe(403)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await call()).status).toBe(403)
    expect(m.sync).not.toHaveBeenCalled()
  })

  it('400 on a malformed id', async () => {
    expect((await call('nope')).status).toBe(400)
  })

  it('syncs under the write scope', async () => {
    expect((await call()).status).toBe(200)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:write')
    expect(m.sync).toHaveBeenCalledWith(ID, expect.objectContaining({ id: 'a1' }))
  })

  it('passes an import failure through with its status', async () => {
    m.sync.mockRejectedValueOnce(new ImportError('List not found', 404))
    expect((await call()).status).toBe(404)
  })
})
