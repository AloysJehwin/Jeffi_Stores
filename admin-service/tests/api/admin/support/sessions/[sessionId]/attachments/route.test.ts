import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/drive/files', () => {
  class DriveError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }
  return { storeFile: vi.fn(), logDriveAccess: vi.fn(), DriveError }
})
vi.mock('@/lib/drive/folders', () => ({ supportFolder: vi.fn() }))
vi.mock('@/lib/support/http', () => ({ adminChat: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/support/sessions/[sessionId]/attachments/route'
import { storeFile, logDriveAccess, DriveError } from '@/lib/drive/files'
import { supportFolder } from '@/lib/drive/folders'
import { adminChat } from '@/lib/support/http'

const ctx = { params: Promise.resolve({ sessionId: 's1' }) }
const upload = (file?: File) => {
  const form = new FormData()
  if (file) form.append('file', file)
  return new NextRequest('http://localhost/api/admin/support/sessions/s1/attachments', { method: 'POST', body: form })
}
const png = () => new File([new Uint8Array(4)], 'shot.png', { type: 'image/png' })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(adminChat).mockResolvedValue({ admin: { adminId: 'a1' }, session: { id: 's1', ticket_number: 'T-42' } } as any)
  vi.mocked(supportFolder).mockResolvedValue('folder-1' as any)
  vi.mocked(logDriveAccess).mockResolvedValue(undefined as any)
})

describe('POST /api/admin/support/sessions/[sessionId]/attachments', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(adminChat).mockResolvedValueOnce(deny(401))
    expect((await POST(upload(png()), ctx)).status).toBe(401)
    vi.mocked(adminChat).mockResolvedValueOnce(deny(403))
    expect((await POST(upload(png()), ctx)).status).toBe(403)
    expect(adminChat).toHaveBeenCalledWith(expect.anything(), 's1', 'customers:write')
    expect(storeFile).not.toHaveBeenCalled()
  })

  it('returns 400 when no file is sent', async () => {
    expect((await POST(upload(), ctx)).status).toBe(400)
    expect(storeFile).not.toHaveBeenCalled()
  })

  it('stores the file in the chat folder and returns the attachment', async () => {
    vi.mocked(storeFile).mockResolvedValue({ id: 'f1', kind: 'image', mime_type: 'image/png', name: 'shot.png', size_bytes: '4', width: 1, height: 2 } as any)
    const res = await POST(upload(png()), ctx)
    expect(await res.json()).toEqual({ attachment: { id: 'f1', kind: 'image', mime: 'image/png', name: 'shot.png', size: 4, width: 1, height: 2 } })
    expect(supportFolder).toHaveBeenCalledWith('T-42', 's1')
    expect(storeFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'shot.png', mime: 'image/png', folderId: 'folder-1', source: 'support', adminId: 'a1' }))
    expect(logDriveAccess).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'f1', adminId: 'a1', action: 'upload' }))
  })

  it('surfaces a DriveError status', async () => {
    vi.mocked(storeFile).mockRejectedValue(new DriveError('Too big', 413))
    const res = await POST(upload(png()), ctx)
    expect(res.status).toBe(413)
    expect((await res.json()).error).toBe('Too big')
  })

  it('returns 500 when storage fails', async () => {
    vi.mocked(storeFile).mockRejectedValue(new Error('s3'))
    expect((await POST(upload(png()), ctx)).status).toBe(500)
  })
})
