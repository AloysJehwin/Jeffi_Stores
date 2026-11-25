import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/drive/listing', () => ({ fileFor: vi.fn() }))
vi.mock('@/lib/drive/files', () => ({ logDriveAccess: vi.fn(), readFileBytes: vi.fn(), signFile: vi.fn() }))
vi.mock('@/lib/drive/http', () => ({ driveActor: vi.fn(), denied: vi.fn(), reqMeta: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/drive/files/[id]/content/route'
import { fileFor } from '@/lib/drive/listing'
import { logDriveAccess, readFileBytes, signFile } from '@/lib/drive/files'
import { driveActor, denied, reqMeta } from '@/lib/drive/http'

const ctx = { params: Promise.resolve({ id: 'file-1' }) }
const req = (qs = '') => new NextRequest(`http://localhost/api/admin/drive/files/file-1/content${qs}`)
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })
const row = { id: 'file-1', mime_type: 'image/png' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(driveActor).mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: [] } as any)
  vi.mocked(denied).mockReturnValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
  vi.mocked(reqMeta).mockReturnValue({} as any)
  vi.mocked(logDriveAccess).mockResolvedValue(undefined as any)
  vi.mocked(fileFor).mockResolvedValue({ row, level: 'view' } as any)
  vi.mocked(signFile).mockResolvedValue('https://cdn.test/signed?x=1' as any)
})

describe('GET /api/admin/drive/files/[id]/content', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(driveActor).mockResolvedValueOnce(deny(401))
    expect((await GET(req(), ctx)).status).toBe(401)
    vi.mocked(driveActor).mockResolvedValueOnce(deny(403))
    expect((await GET(req(), ctx)).status).toBe(403)
    expect(driveActor).toHaveBeenCalledWith(expect.anything(), 'drive:read')
  })

  it('returns 404 when the file is not visible', async () => {
    vi.mocked(fileFor).mockResolvedValue(null as any)
    expect((await GET(req(), ctx)).status).toBe(404)
    expect(signFile).not.toHaveBeenCalled()
  })

  it('redirects to a signed link and logs a view', async () => {
    const res = await GET(req(), ctx)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://cdn.test/signed?x=1')
    expect(signFile).toHaveBeenCalledWith(row, { thumb: false, download: false })
    expect(logDriveAccess).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'file-1', adminId: 'a1', action: 'view' }))
  })

  it('logs a download, and skips the log for thumbnails', async () => {
    await GET(req('?download=1'), ctx)
    expect(logDriveAccess).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'download' }))
    expect(signFile).toHaveBeenLastCalledWith(row, { thumb: false, download: true })
    vi.mocked(logDriveAccess).mockClear()
    await GET(req('?thumb=1'), ctx)
    expect(logDriveAccess).not.toHaveBeenCalled()
    expect(signFile).toHaveBeenLastCalledWith(row, { thumb: true, download: false })
  })

  it('streams a PDF same-origin for raw=1', async () => {
    vi.mocked(fileFor).mockResolvedValue({ row: { ...row, mime_type: 'application/pdf' }, level: 'view' } as any)
    vi.mocked(readFileBytes).mockResolvedValue(Buffer.from('%PDF') as any)
    const res = await GET(req('?raw=1'), ctx)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('%PDF')
    expect(signFile).not.toHaveBeenCalled()
  })

  it('propagates a storage failure', async () => {
    vi.mocked(signFile).mockRejectedValue(new Error('s3'))
    await expect(GET(req(), ctx)).rejects.toThrow('s3')
  })
})
