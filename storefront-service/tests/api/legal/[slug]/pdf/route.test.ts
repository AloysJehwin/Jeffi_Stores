import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/legals/store-policies', () => ({
  getStorePolicyBySlug: vi.fn(),
  getStoreLegalContext: vi.fn(async () => ({ slug: null, info: null })),
  storeSealForPdf: vi.fn(async () => undefined),
  policyPdfName: (store: string | null, slug: string) => `${store || 'jeffistores'}-${slug}.pdf`,
}))
vi.mock('@/lib/documents/policy-pdf', () => ({
  generatePolicyPDF: vi.fn(),
}))

import { GET } from '@storefront/app/api/(public)/legal/[slug]/pdf/route'
import { getStorePolicyBySlug, getStoreLegalContext, storeSealForPdf } from '@/lib/legals/store-policies'
import { generatePolicyPDF } from '@/lib/documents/policy-pdf'

const mockGetPolicy = vi.mocked(getStorePolicyBySlug)
const mockGeneratePDF = vi.mocked(generatePolicyPDF)

const params = { params: Promise.resolve({ slug: 'privacy-policy' }) }

function makeRequest() {
  return new Request('http://localhost/api/legal/privacy-policy/pdf')
}

const mockPolicy = {
  slug: 'privacy-policy',
  title: 'Privacy Policy',
  content: 'Content here',
}

describe('GET /api/legal/[slug]/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 when policy not found', async () => {
    mockGetPolicy.mockResolvedValueOnce(undefined as any)
    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(404)
  })

  it('returns PDF binary with correct headers on success', async () => {
    const pdfBuffer = Buffer.from('fake-pdf-data')
    mockGetPolicy.mockResolvedValueOnce(mockPolicy as any)
    mockGeneratePDF.mockResolvedValueOnce(pdfBuffer as any)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('privacy-policy')
    expect(res.headers.get('content-disposition')).toContain('.pdf')
    expect(res.headers.get('content-length')).toBe(String(pdfBuffer.length))
  })

  it('sets cache-control header', async () => {
    const pdfBuffer = Buffer.from('pdf')
    mockGetPolicy.mockResolvedValueOnce(mockPolicy as any)
    mockGeneratePDF.mockResolvedValueOnce(pdfBuffer as any)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.headers.get('cache-control')).toContain('max-age=3600')
  })

  it('returns 500 when generatePolicyPDF throws', async () => {
    mockGetPolicy.mockResolvedValueOnce(mockPolicy as any)
    mockGeneratePDF.mockRejectedValueOnce(new Error('pdf generation failed'))

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Failed to generate PDF')
  })

  it('passes the policy object to generatePolicyPDF', async () => {
    const pdfBuffer = Buffer.from('pdf')
    mockGetPolicy.mockResolvedValueOnce(mockPolicy as any)
    mockGeneratePDF.mockResolvedValueOnce(pdfBuffer as any)

    await GET(makeRequest() as any, params as any)
    expect(mockGeneratePDF).toHaveBeenCalledWith(mockPolicy, undefined)
  })

  it("names a tenant's PDF after the store and stamps no platform seal", async () => {
    mockGetPolicy.mockResolvedValueOnce(mockPolicy as any)
    vi.mocked(getStoreLegalContext).mockResolvedValueOnce({ slug: 'acme', info: null })
    vi.mocked(storeSealForPdf).mockResolvedValueOnce(null)
    mockGeneratePDF.mockResolvedValueOnce(Buffer.from('pdf') as any)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.headers.get('content-disposition')).toContain('acme-privacy-policy.pdf')
    expect(mockGeneratePDF).toHaveBeenCalledWith(mockPolicy, { seal: null })
  })
})
