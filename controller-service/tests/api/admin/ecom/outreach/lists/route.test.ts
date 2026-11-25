import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ listLists: vi.fn(), createSheetList: vi.fn(), importUpload: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/lists', () => ({ listLists: m.listLists }))
vi.mock('@controller/lib/outreach/import', () => ({
  createSheetList: m.createSheetList,
  importUpload: m.importUpload,
  ImportError: class ImportError extends Error {
    constructor(message: string, public status = 400) {
      super(message)
    }
  },
}))

import { GET, POST } from '@controller/app/api/(admin)/admin/ecom/outreach/lists/route'
import { ImportError } from '@controller/lib/outreach/import'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const url = 'http://localhost/api/admin/ecom/outreach/lists'
const json = (body: unknown) => new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const upload = (fields: Record<string, string>, file?: File) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  if (file) fd.set('file', file)
  return new NextRequest(url, { method: 'POST', body: fd })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
  m.listLists.mockResolvedValue([{ id: 'l1' }])
  m.createSheetList.mockResolvedValue({ list: { id: 'l2' }, summary: { inserted: 2 } })
  m.importUpload.mockResolvedValue({ list: { id: 'l3' }, summary: { inserted: 5 } })
})

describe('/api/admin/ecom/outreach/lists', () => {
  it('401 / 403 gates', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await GET(new NextRequest(url))).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await POST(json({ name: 'n', sheetUrl: 'x' }))).status).toBe(403)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await POST(json({ name: 'n', sheetUrl: 'x' }))).status).toBe(403)
    expect(m.createSheetList).not.toHaveBeenCalled()
  })

  it('GET lists the program lists', async () => {
    expect(await (await GET(new NextRequest(url))).json()).toEqual({ lists: [{ id: 'l1' }] })
    expect(m.listLists).toHaveBeenCalledWith('showcase-offer')
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:read')
  })

  it('POST 400s on a missing name or sheet link, and on an upload without a file', async () => {
    expect((await POST(json({ name: '' }))).status).toBe(400)
    expect((await POST(json({ sheetUrl: 'x' }))).status).toBe(400)
    expect((await POST(upload({ name: 'n' }))).status).toBe(400)
  })

  it('POST { name, sheetUrl } creates a Sheet-backed list', async () => {
    const res = await POST(json({ name: 'Chennai tailors', sheetUrl: 'https://docs.google.com/spreadsheets/d/abc/edit' }))
    expect(res.status).toBe(201)
    expect(m.createSheetList).toHaveBeenCalledWith(expect.objectContaining({ program: 'showcase-offer', name: 'Chennai tailors', actor: expect.objectContaining({ id: 'a1' }) }))
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:write')
  })

  it('POST multipart imports the file', async () => {
    const file = new File(['business_name,phone,source\nA,9876543210,s\n'], 'c.csv', { type: 'text/csv' })
    const res = await POST(upload({ name: 'Batch 1' }, file))
    expect(res.status).toBe(201)
    expect(m.importUpload).toHaveBeenCalledWith(expect.objectContaining({ program: 'showcase-offer', name: 'Batch 1', fileName: 'c.csv' }))
  })

  it('POST surfaces an import failure with its status', async () => {
    m.createSheetList.mockRejectedValueOnce(new ImportError('Missing required column: source', 400))
    const res = await POST(json({ name: 'n', sheetUrl: 'abc' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/source/)
  })
})
