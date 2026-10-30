import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/email-campaigns', () => ({ renderCampaignEmail: vi.fn() }))
vi.mock('@/lib/templates/variables', async () => {
  const shared = await vi.importActual<typeof import('@/lib/templates/variables-shared')>(
    '@/lib/templates/variables-shared'
  )
  return { ...shared, resolveTemplateVariables: vi.fn() }
})

import { POST } from '@controller/app/api/(admin)/admin/mailer/preview/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { renderCampaignEmail } from '@/lib/shared/email-campaigns'
import { resolveTemplateVariables } from '@/lib/templates/variables'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockRenderCampaignEmail = vi.mocked(renderCampaignEmail)
const mockResolve = vi.mocked(resolveTemplateVariables)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['mailer'] }

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/mailer/preview', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/admin/mailer/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolve.mockResolvedValue({ customer_first_name: 'Preview', store_name: 'Acme' })
    mockRenderCampaignEmail.mockReturnValue({ html: '<p>Hello</p>' } as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest({ template_key: 'welcome' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest({ template_key: 'welcome' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns 400 when template_key is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/template_key/i)
  })

  it('returns rendered HTML on success', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const res = await POST(
      makeRequest({
        template_key: 'welcome',
        template_data: { body: 'Hello {{name}}' },
        subject: 'Hi there',
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('html')
    expect(mockRenderCampaignEmail).toHaveBeenCalledOnce()
  })

  it('handles missing template_data gracefully', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const res = await POST(makeRequest({ template_key: 'welcome' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.html).toBeDefined()
  })

  it('fills the subject and hands store + sample customer variables to the renderer', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    await POST(
      makeRequest({
        template_key: 'promo',
        template_data: { headline: 'Big {{store_name}}' },
        subject: 'Sale for {{customer_first_name}}',
      })
    )

    const [, data, name, , storeName, vars] = mockRenderCampaignEmail.mock.calls[0]
    expect(data.subject).toBe('Sale for Preview')
    expect(data.headline).toBe('Big {{store_name}}')
    expect(name).toBe('Preview')
    expect(storeName).toBe('Acme')
    expect(vars).toEqual({ customer_first_name: 'Preview', store_name: 'Acme' })
  })

  it('accepts non-string data values', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const res = await POST(
      makeRequest({
        template_key: 'promo',
        template_data: { count: 5 },
      })
    )
    expect(res.status).toBe(200)
  })
})
