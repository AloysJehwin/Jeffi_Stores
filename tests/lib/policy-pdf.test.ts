import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>()
  return {
    ...actual,
    default: actual,
    join: vi.fn((...args: string[]) => args.join('/')),
  }
})

import { generatePolicyPDF } from '@/lib/policy-pdf'
import type { Policy, Section } from '@/app/legal/policies'

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
function makeSection(heading: string, body: string | string[]): Section {
  return { heading, body }
}

function makePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    title: 'Privacy Policy',
    slug: 'privacy-policy',
    description: 'How we handle your data.',
    lastUpdated: '2024-01-01',
    sections: [
      makeSection('Introduction', 'We value your privacy.'),
      makeSection('Data Collection', ['We collect emails.', 'We collect names.']),
    ],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// generatePolicyPDF
// ---------------------------------------------------------------------------
describe('generatePolicyPDF', () => {
  it('returns a Buffer', async () => {
    const result = await generatePolicyPDF(makePolicy())
    expect(result).toBeInstanceOf(Buffer)
    expect(result.length).toBeGreaterThan(0)
  })

  it('handles policy with string body sections', async () => {
    const policy = makePolicy({
      sections: [makeSection('Overview', 'This is the overview text.')],
    })
    const result = await generatePolicyPDF(policy)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles policy with array body sections', async () => {
    const policy = makePolicy({
      sections: [makeSection('Terms', ['Term 1', 'Term 2', 'Term 3'])],
    })
    const result = await generatePolicyPDF(policy)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles mixed string and array sections', async () => {
    const policy = makePolicy({
      sections: [
        makeSection('String Section', 'Plain text body.'),
        makeSection('List Section', ['Item A', 'Item B']),
        makeSection('Another String', 'More plain text.'),
      ],
    })
    const result = await generatePolicyPDF(policy)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles policy with empty sections array', async () => {
    const policy = makePolicy({ sections: [] })
    const result = await generatePolicyPDF(policy)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles policy with many sections (pagination)', async () => {
    const sections = Array.from({ length: 30 }, (_, i) =>
      makeSection(`Section ${i + 1}`, `Body text for section ${i + 1}. This is a longer body to test layout.`)
    )
    const policy = makePolicy({ sections })
    const result = await generatePolicyPDF(policy)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles policy with sections having many list items', async () => {
    const longList = Array.from({ length: 20 }, (_, i) => `List item ${i + 1} with detailed text content here.`)
    const policy = makePolicy({
      sections: [makeSection('Long List Section', longList)],
    })
    const result = await generatePolicyPDF(policy)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles different policy slugs and titles', async () => {
    const policies: Policy[] = [
      makePolicy({ title: 'Terms of Service', slug: 'terms-of-service' }),
      makePolicy({ title: 'Return Policy', slug: 'return-policy' }),
      makePolicy({ title: 'Shipping Policy', slug: 'shipping-policy' }),
    ]
    for (const policy of policies) {
      const result = await generatePolicyPDF(policy)
      expect(result).toBeInstanceOf(Buffer)
    }
  })

  it('handles empty string body section', async () => {
    const policy = makePolicy({
      sections: [makeSection('Empty Body', '')],
    })
    const result = await generatePolicyPDF(policy)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles empty array body section', async () => {
    const policy = makePolicy({
      sections: [makeSection('Empty List', [])],
    })
    const result = await generatePolicyPDF(policy)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles very long description', async () => {
    const policy = makePolicy({
      description: 'A '.repeat(500) + 'very long description.',
    })
    const result = await generatePolicyPDF(policy)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles very long section body text', async () => {
    const longBody = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(50)
    const policy = makePolicy({
      sections: [makeSection('Long Body', longBody)],
    })
    const result = await generatePolicyPDF(policy)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles lastUpdated date string', async () => {
    const policy = makePolicy({ lastUpdated: '15 June 2024' })
    const result = await generatePolicyPDF(policy)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('returns a non-empty buffer with real PDF content', async () => {
    const result = await generatePolicyPDF(makePolicy())
    // policy-pdf.ts loads PDFKit via eval('require'), bypassing vi.mock — real PDF binary is produced
    expect(result.length).toBeGreaterThan(0)
  })
})
