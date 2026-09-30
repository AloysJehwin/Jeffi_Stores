import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/shared/whatsapp', () => ({
  WA_TEMPLATE_REGISTRY: { promo_offer: { label: 'Promo', category: 'marketing', fields: ['code'] } },
  sendTemplateByKey: vi.fn().mockResolvedValue(true),
  sendFreeTextWhatsApp: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/shared/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

import { GET, POST } from '@/app/api/admin/customers/[id]/whatsapp/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, queryMany } from '@/lib/shared/db'
import { sendTemplateByKey, sendFreeTextWhatsApp } from '@/lib/shared/whatsapp'
import { logActivity } from '@/lib/shared/activity'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockTemplate = vi.mocked(sendTemplateByKey)
const mockFreeText = vi.mocked(sendFreeTextWhatsApp)

const ADMIN = { adminId: 'admin-1', username: 'a', role: 'admin', scopes: ['customers:read', 'customers:write'] }
const params = Promise.resolve({ id: 'cust-1' })

function req(body?: object) {
  return {
    json: async () => body ?? {},
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(ADMIN as any)
  mockHasScope.mockReturnValue(true)
  mockQueryMany.mockResolvedValue([] as any)
})

describe('GET whatsapp thread', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(req(), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 without customers:read scope', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(req(), { params })
    expect(res.status).toBe(403)
  })

  it('returns phone, thread and templates', async () => {
    mockQueryOne.mockResolvedValue({ phone: '9876543210' })
    mockQueryMany.mockResolvedValue([{ id: 'm1' }] as any)
    const res = await GET(req(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.phone).toBe('9876543210')
    expect(body.thread).toHaveLength(1)
    expect(body.templates).toBeTruthy()
  })

  it('returns an empty thread when the customer has no phone', async () => {
    mockQueryOne.mockResolvedValue({ phone: null })
    const res = await GET(req(), { params })
    const body = await res.json()
    expect(body.thread).toEqual([])
  })
})

describe('POST send whatsapp', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(req({ text: 'hi' }), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 without customers:write scope', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(req({ text: 'hi' }), { params })
    expect(res.status).toBe(403)
  })

  it('returns 400 when customer has no phone', async () => {
    mockQueryOne.mockResolvedValue({ phone: null })
    const res = await POST(req({ text: 'hi' }), { params })
    expect(res.status).toBe(400)
  })

  it('templateKey → sendTemplateByKey (defaults variables to {})', async () => {
    mockQueryOne.mockResolvedValue({ phone: '9876543210' })
    const res = await POST(req({ templateKey: 'promo_offer' }), { params })
    expect(res.status).toBe(200)
    expect(mockTemplate).toHaveBeenCalledWith('9876543210', 'promo_offer', {})
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('swallows a rejected logActivity on success', async () => {
    mockQueryOne.mockResolvedValue({ phone: '9876543210' })
    vi.mocked(logActivity).mockRejectedValueOnce(new Error('audit down'))
    const res = await POST(req({ text: 'hi' }), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('text → sendFreeTextWhatsApp', async () => {
    mockQueryOne.mockResolvedValue({ phone: '9876543210' })
    const res = await POST(req({ text: '  hello  ' }), { params })
    expect(mockFreeText).toHaveBeenCalledWith({ phone: '9876543210', body: 'hello' })
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('returns 400 when neither templateKey nor text supplied', async () => {
    mockQueryOne.mockResolvedValue({ phone: '9876543210' })
    const res = await POST(req({}), { params })
    expect(res.status).toBe(400)
  })

  it('returns success:false when send fails', async () => {
    mockQueryOne.mockResolvedValue({ phone: '9876543210' })
    mockFreeText.mockResolvedValue(false)
    const res = await POST(req({ text: 'hi' }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(false)
  })
})
