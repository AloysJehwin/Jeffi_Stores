import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@jeffi/tenancy', () => ({ uploadTemplateAsset: vi.fn() }))
vi.mock('@/lib/shared/form-file', () => ({ readUpload: vi.fn() }))
vi.mock('@/lib/messaging/broadcast-shared', () => ({ MAX_ATTACHMENT_BYTES: 5 * 1024 * 1024 }))

import { POST } from '@admin/app/api/(admin)/admin/mailer/attachments/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { uploadTemplateAsset } from '@jeffi/tenancy'
import { readUpload } from '@/lib/shared/form-file'

const req = () => new NextRequest('http://localhost/api/admin/mailer/attachments', { method: 'POST' })
const upload = (over: any = {}) => ({ bytes: Buffer.from('pdf!'), mime: 'application/pdf', name: 'a.pdf', ...over })

describe('POST mailer/attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(readUpload).mockResolvedValue(upload() as any)
    vi.mocked(uploadTemplateAsset).mockResolvedValue({ url: 'https://cdn/a.pdf' } as any)
  })

  it('401s and 403s (mailer:write)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req())).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'm', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req())).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('m', [], 'mailer:write')
    expect(readUpload).not.toHaveBeenCalled()
  })

  it('400s on an unreadable upload or a disallowed type', async () => {
    vi.mocked(readUpload).mockResolvedValue({ error: 'No file' } as any)
    expect((await POST(req())).status).toBe(400)
    vi.mocked(readUpload).mockResolvedValue(upload({ mime: 'application/x-msdownload' }) as any)
    expect((await POST(req())).status).toBe(400)
    expect(uploadTemplateAsset).not.toHaveBeenCalled()
  })

  it('413s on an oversized file', async () => {
    vi.mocked(readUpload).mockResolvedValue(upload({ bytes: Buffer.alloc(5 * 1024 * 1024 + 1) }) as any)
    expect((await POST(req())).status).toBe(413)
    expect(uploadTemplateAsset).not.toHaveBeenCalled()
  })

  it('stores the attachment under mailer', async () => {
    expect(await (await POST(req())).json()).toEqual({ url: 'https://cdn/a.pdf', name: 'a.pdf', size: 4, mime: 'application/pdf' })
    expect(uploadTemplateAsset).toHaveBeenCalledWith(expect.any(Buffer), 'mailer', 'application/pdf')
  })

  it('names an unnamed upload attachment', async () => {
    vi.mocked(readUpload).mockResolvedValue(upload({ name: '' }) as any)
    expect((await (await POST(req())).json()).name).toBe('attachment')
  })

  it('propagates a storage failure', async () => {
    vi.mocked(uploadTemplateAsset).mockRejectedValue(new Error('s3'))
    await expect(POST(req())).rejects.toThrow('s3')
  })
})
