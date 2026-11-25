import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const customerChat = vi.hoisted(() => vi.fn())
const storeFile = vi.hoisted(() => vi.fn())
const logDriveAccess = vi.hoisted(() => vi.fn())
const supportFolder = vi.hoisted(() => vi.fn())
const DriveError = vi.hoisted(
  () =>
    class DriveError extends Error {
      constructor(
        message: string,
        public status: number
      ) {
        super(message)
      }
    }
)

vi.mock('@/lib/support/http', () => ({ customerChat }))
vi.mock('@/lib/drive/files', () => ({ storeFile, logDriveAccess, DriveError }))
vi.mock('@/lib/drive/folders', () => ({ supportFolder }))

import { POST } from '@storefront/app/api/(public)/support/sessions/[sessionId]/attachments/route'

const ctx = { params: Promise.resolve({ sessionId: 's1' }) }
const post = (file: File | null, headers: Record<string, string> = {}) => {
  const fd = new FormData()
  if (file) fd.append('file', file)
  return POST(new NextRequest('http://localhost/api/support/sessions/s1/attachments', { method: 'POST', body: fd, headers }), ctx)
}
const png = () => new File([new Uint8Array(8)], 'shot.png', { type: 'image/png' })

describe('POST /api/support/sessions/[sessionId]/attachments', () => {
  beforeEach(() => {
    customerChat.mockResolvedValue({ user: { userId: 'u1' }, session: { status: 'open', ticket_number: 'T-1' } })
    supportFolder.mockResolvedValue('folder-1')
    storeFile.mockResolvedValue({ id: 'f1', kind: 'image', mime_type: 'image/png', name: 'shot.png', size_bytes: '8', width: 10, height: 10 })
    logDriveAccess.mockResolvedValue(undefined)
  })

  it('passes the chat access denial through', async () => {
    customerChat.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await post(png())).status).toBe(401)
    expect(storeFile).not.toHaveBeenCalled()
  })

  it('409s when the chat is closed', async () => {
    customerChat.mockResolvedValue({ user: { userId: 'u1' }, session: { status: 'closed', ticket_number: 'T-1' } })
    expect((await post(png())).status).toBe(409)
    expect(storeFile).not.toHaveBeenCalled()
  })

  it('413s on an oversized declared length and 400s without a file', async () => {
    const big = new NextRequest('http://localhost/api/support/sessions/s1/attachments', { method: 'POST' })
    vi.spyOn(big.headers, 'get').mockImplementation((n: string) => (n === 'content-length' ? String(26 * 1024 * 1024) : null))
    expect((await POST(big, ctx)).status).toBe(413)
    const res = await post(null)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('No file')
  })

  it('stores the file privately in the chat Drive folder and returns its reference', async () => {
    const res = await post(png())
    expect(await res.json()).toEqual({
      attachment: { id: 'f1', kind: 'image', mime: 'image/png', name: 'shot.png', size: 8, width: 10, height: 10 },
    })
    expect(supportFolder).toHaveBeenCalledWith('T-1', 's1')
    expect(storeFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'shot.png', mime: 'image/png', folderId: 'folder-1', source: 'support', userId: 'u1', maxBytes: 25 * 1024 * 1024 })
    )
    expect(logDriveAccess).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'f1', userId: 'u1', action: 'upload' }))
  })

  it('maps a Drive validation error to its status', async () => {
    storeFile.mockRejectedValue(new DriveError('File type not allowed', 415))
    const res = await post(png())
    expect(res.status).toBe(415)
    expect((await res.json()).error).toBe('File type not allowed')
  })

  it('500s on an unexpected failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    storeFile.mockRejectedValue(new Error('s3'))
    const res = await post(png())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Upload failed')
  })
})
