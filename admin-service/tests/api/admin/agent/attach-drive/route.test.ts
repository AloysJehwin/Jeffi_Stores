import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/drive/listing', () => ({ fileFor: vi.fn() }))
vi.mock('@/lib/drive/files', () => ({ logDriveAccess: vi.fn(), readFileBytes: vi.fn() }))
vi.mock('@/lib/drive/http', () => ({
  denied: vi.fn(() => NextResponse.json({ error: 'Not found' }, { status: 404 })),
  driveActor: vi.fn(),
  reqMeta: vi.fn(() => ({})),
}))
vi.mock('@/lib/admin-agent/file-types', () => ({
  MAX_ATTACHMENT_BYTES: 10 * 1024 * 1024,
  resolveMime: vi.fn(),
  unsupportedMessage: vi.fn((m: string) => `Unsupported ${m}`),
}))

import { POST } from '@admin/app/api/(admin)/admin/agent/attach-drive/route'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { fileFor } from '@/lib/drive/listing'
import { logDriveAccess, readFileBytes } from '@/lib/drive/files'
import { driveActor } from '@/lib/drive/http'
import { resolveMime } from '@/lib/admin-agent/file-types'

const ID = '11111111-1111-4111-8111-111111111111'
const req = (body: unknown) => new NextRequest('http://localhost/api/admin/agent/attach-drive', { method: 'POST', body: JSON.stringify(body) })
const file = (over = {}) => ({ row: { id: ID, name: 'a.pdf', mime_type: 'application/pdf', size_bytes: '100', ...over } })

describe('POST /api/admin/agent/attach-drive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(driveActor).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(fileFor).mockResolvedValue(file() as any)
    vi.mocked(resolveMime).mockReturnValue('application/pdf')
    vi.mocked(readFileBytes).mockResolvedValue(Buffer.from('hello'))
    vi.mocked(queryOne).mockResolvedValue({ id: 'att1', expires_at: '2026-12-01' })
    vi.mocked(logDriveAccess).mockResolvedValue(undefined as any)
  })

  it('returns the drive gate response when the actor is rejected', async () => {
    vi.mocked(driveActor).mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) as any)
    expect((await POST(req({ fileId: ID }))).status).toBe(401)
    expect(fileFor).not.toHaveBeenCalled()
  })

  it('403s without agent:write', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req({ fileId: ID }))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('manager', [], 'agent:write')
  })

  it('400s on a bad file id', async () => {
    expect((await POST(req({ fileId: 'nope' }))).status).toBe(400)
  })

  it('404s when the file is not visible', async () => {
    vi.mocked(fileFor).mockResolvedValue(null as any)
    expect((await POST(req({ fileId: ID }))).status).toBe(404)
  })

  it('415s on an unsupported type', async () => {
    vi.mocked(resolveMime).mockReturnValue(null as any)
    expect((await POST(req({ fileId: ID }))).status).toBe(415)
  })

  it('413s on an oversized file', async () => {
    vi.mocked(fileFor).mockResolvedValue(file({ size_bytes: String(11 * 1024 * 1024) }) as any)
    expect((await POST(req({ fileId: ID }))).status).toBe(413)
    expect(readFileBytes).not.toHaveBeenCalled()
  })

  it('copies the file into attachments and logs the view', async () => {
    const res = await POST(req({ fileId: ID }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ attachment_id: 'att1', filename: 'a.pdf', mime_type: 'application/pdf', byte_size: 5, expires_at: '2026-12-01' })
    const [sql, params] = vi.mocked(queryOne).mock.calls[0] as any
    expect(sql).toContain('INSERT INTO admin_agent_attachments')
    expect(params.slice(0, 4)).toEqual(['a1', 'a.pdf', 'application/pdf', 5])
    expect(logDriveAccess).toHaveBeenCalledWith(expect.objectContaining({ fileId: ID, adminId: 'a1', action: 'view' }))
  })

  it('500s when the insert returns nothing', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    expect((await POST(req({ fileId: ID }))).status).toBe(500)
    expect(logDriveAccess).not.toHaveBeenCalled()
  })
})
