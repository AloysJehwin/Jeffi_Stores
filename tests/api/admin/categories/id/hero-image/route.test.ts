import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ query: vi.fn(), queryOne: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  }
})

import { POST, DELETE } from '@/app/api/admin/categories/[id]/hero-image/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'

const ADMIN = { adminId: 'a1', role: 'super_admin', scopes: ['categories:write'] }
const params = Promise.resolve({ id: 'cat-1' })
const CAT = { slug: 'fasteners' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(query).mockResolvedValue({ rows: [] } as any)
  vi.mocked(queryOne).mockResolvedValue(CAT as any)
})

function makeFormReq(fields: Record<string, string>, fileName = 'image.jpg') {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  const file = new File(['data'], fileName, { type: 'image/jpeg' })
  form.append('file', file)
  return new NextRequest('http://localhost', { method: 'POST', body: form })
}

function makeDeleteReq(body: unknown) {
  return new NextRequest('http://localhost', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/categories/[id]/hero-image', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makeFormReq({ variant: 'mobile' }), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(makeFormReq({ variant: 'mobile' }), { params })
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid variant', async () => {
    const form = new FormData()
    form.append('variant', 'tablet')
    form.append('file', new File(['d'], 'x.jpg', { type: 'image/jpeg' }))
    const res = await POST(new NextRequest('http://localhost', { method: 'POST', body: form }), { params })
    expect(res.status).toBe(400)
  })

  it('returns 400 when file missing', async () => {
    const form = new FormData()
    form.append('variant', 'mobile')
    const res = await POST(new NextRequest('http://localhost', { method: 'POST', body: form }), { params })
    expect(res.status).toBe(400)
  })

  it('returns 400 for disallowed extension', async () => {
    const form = new FormData()
    form.append('variant', 'mobile')
    form.append('file', new File(['d'], 'img.gif', { type: 'image/gif' }))
    const res = await POST(new NextRequest('http://localhost', { method: 'POST', body: form }), { params })
    expect(res.status).toBe(400)
  })

  it('returns 404 when category not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await POST(makeFormReq({ variant: 'mobile' }), { params })
    expect(res.status).toBe(404)
  })

  it('uploads mobile image and returns path', async () => {
    const res = await POST(makeFormReq({ variant: 'mobile' }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.path).toContain('mobile')
    expect(body.path).toContain('fasteners')
  })

  it('uploads desktop image and returns path', async () => {
    const res = await POST(makeFormReq({ variant: 'desktop' }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.path).toContain('desktop')
  })
})

describe('DELETE /api/admin/categories/[id]/hero-image', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await DELETE(makeDeleteReq({ variant: 'mobile' }), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await DELETE(makeDeleteReq({ variant: 'mobile' }), { params })
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid variant', async () => {
    const res = await DELETE(makeDeleteReq({ variant: 'extra' }), { params })
    expect(res.status).toBe(400)
  })

  it('clears mobile hero image', async () => {
    const res = await DELETE(makeDeleteReq({ variant: 'mobile' }), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('clears desktop hero image', async () => {
    const res = await DELETE(makeDeleteReq({ variant: 'desktop' }), { params })
    expect(res.status).toBe(200)
  })
})
