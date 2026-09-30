import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/legals/policies', () => ({
  getPolicyBySlug: vi.fn(),
}))
vi.mock('@/lib/documents/policy-pdf', () => ({
  generatePolicyPDF: vi.fn(),
}))

import { GET } from '@/app/api/legal/[slug]/pdf/route'
import { getPolicyBySlug } from '@/lib/legals/policies'
import { generatePolicyPDF } from '@/lib/documents/policy-pdf'

const mockGetPolicy = vi.mocked(getPolicyBySlug)
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
    mockGetPolicy.mockReturnValueOnce(undefined as any)
    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(404)
  })

  it('returns PDF binary with correct headers on success', async () => {
    const pdfBuffer = Buffer.from('fake-pdf-data')
    mockGetPolicy.mockReturnValueOnce(mockPolicy as any)
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
    mockGetPolicy.mockReturnValueOnce(mockPolicy as any)
    mockGeneratePDF.mockResolvedValueOnce(pdfBuffer as any)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.headers.get('cache-control')).toContain('max-age=3600')
  })

  it('returns 500 when generatePolicyPDF throws', async () => {
    mockGetPolicy.mockReturnValueOnce(mockPolicy as any)
    mockGeneratePDF.mockRejectedValueOnce(new Error('pdf generation failed'))

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Failed to generate PDF')
  })

  it('passes the policy object to generatePolicyPDF', async () => {
    const pdfBuffer = Buffer.from('pdf')
    mockGetPolicy.mockReturnValueOnce(mockPolicy as any)
    mockGeneratePDF.mockResolvedValueOnce(pdfBuffer as any)

    await GET(makeRequest() as any, params as any)
    expect(mockGeneratePDF).toHaveBeenCalledWith(mockPolicy)
  })
})
