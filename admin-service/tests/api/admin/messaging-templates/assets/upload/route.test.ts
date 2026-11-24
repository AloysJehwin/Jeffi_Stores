import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@jeffi/tenancy', () => ({ uploadTemplateAsset: vi.fn() }))
vi.mock('@/lib/shared/form-file', () => ({ readUpload: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/messaging-templates/assets/upload/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { uploadTemplateAsset } from '@jeffi/tenancy'
import { readUpload } from '@/lib/shared/form-file'

const req = () => new NextRequest('http://localhost/api/admin/messaging-templates/assets/upload', { method: 'POST' })
const upload = (over: any = {}) => ({ bytes: Buffer.from('img'), mime: 'image/png', field: (k: string) => (k === 'templateId' ? 'tpl1' : ''), ...over })

describe('POST messaging-templates/assets/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(readUpload).mockResolvedValue(upload() as any)
    vi.mocked(uploadTemplateAsset).mockResolvedValue({ url: 'https://cdn/x.png', key: 'k' } as any)
  })

  it('relays a scope rejection (templates:write)', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await POST(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'templates:write')
    expect(readUpload).not.toHaveBeenCalled()
  })

  it('400s when the upload cannot be read', async () => {
    vi.mocked(readUpload).mockResolvedValue({ error: 'No file' } as any)
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'No file' })
  })

  it('400s on an unsupported type and 413s on a large file', async () => {
    vi.mocked(readUpload).mockResolvedValue(upload({ mime: 'application/pdf' }) as any)
    expect((await POST(req())).status).toBe(400)
    vi.mocked(readUpload).mockResolvedValue(upload({ bytes: Buffer.alloc(5 * 1024 * 1024 + 1) }) as any)
    expect((await POST(req())).status).toBe(413)
    expect(uploadTemplateAsset).not.toHaveBeenCalled()
  })

  it('stores the asset for the template', async () => {
    const res = await POST(req())
    expect(await res.json()).toEqual({ url: 'https://cdn/x.png', key: 'k', bytes: 3, mime: 'image/png' })
    expect(uploadTemplateAsset).toHaveBeenCalledWith(expect.any(Buffer), 'tpl1', 'image/png')
  })

  it('passes a null template id when none is sent', async () => {
    vi.mocked(readUpload).mockResolvedValue(upload({ field: () => '' }) as any)
    await POST(req())
    expect(uploadTemplateAsset).toHaveBeenCalledWith(expect.any(Buffer), null, 'image/png')
  })

  it('propagates a storage failure', async () => {
    vi.mocked(uploadTemplateAsset).mockRejectedValue(new Error('s3'))
    await expect(POST(req())).rejects.toThrow('s3')
  })
})
