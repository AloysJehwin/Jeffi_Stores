import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import DocCheck, { reviewLine } from '@controller/components/admin/ecom/tabs/DocCheck'

// Controller-local siblings pull server bits; stub them to plain spans. The real kit StatusBadge/humanize
// render as-is (already exercised by the committed admin-kit tests).
vi.mock('@controller/components/admin/ecom/EcomUI', () => ({
  Mono: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))
vi.mock('@controller/components/admin/ecom/cells', () => ({
  dateIN: (v: string) => `date:${v}`,
  dateTimeIN: (v: string) => `at:${v}`,
}))

const analysis = (over: Record<string, unknown> = {}) => ({
  verdict: 'review',
  engine: 'pdf',
  source: 'text',
  analyzedAt: '2026-01-01',
  checks: [{ field: 'number', status: 'fail', message: 'mismatch', expected: 'ABC', found: 'XYZ' }],
  fields: { number: 'ABC123', name: 'Acme' },
  ...over,
})

type Doc = Parameters<typeof DocCheck>[0]['doc']
const doc = (over: Partial<Doc> = {}): Doc =>
  ({ analysis: null, analysisStatus: null, current: true, ownerNote: null, ...over }) as unknown as Doc

describe('reviewLine', () => {
  it('returns the raw note when not yet reviewed', () => {
    expect(reviewLine({ status: 'pending', reviewedAt: null, reviewedBy: null, reviewNote: 'hold' })).toBe('hold')
  })
  it('composes an approved/rejected line with reviewer, date and note', () => {
    expect(reviewLine({ status: 'approved', reviewedAt: '2026-01-02', reviewedBy: 'Ann', reviewNote: 'ok' })).toBe('Approved by Ann on date:2026-01-02: ok')
    expect(reviewLine({ status: 'rejected', reviewedAt: '2026-01-02', reviewedBy: null, reviewNote: null })).toBe('Rejected by an admin on date:2026-01-02')
  })
})

describe('DocCheck (branches)', () => {
  it('renders nothing when never checked and no note', () => {
    const { container } = render(<DocCheck doc={doc()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the checking state while analysis is pending (ignores stale analysis)', () => {
    render(<DocCheck doc={doc({ analysisStatus: 'pending', analysis: analysis() as never })} />)
    expect(screen.getByText('Being checked')).toBeInTheDocument()
    // Pending wipes the previous result: no check lines rendered.
    expect(screen.queryByText(/mismatch/)).toBeNull()
  })

  it('shows the failed state with the fallback copy', () => {
    render(<DocCheck doc={doc({ analysisStatus: 'failed' })} />)
    expect(screen.getByText('Couldn’t be checked')).toBeInTheDocument()
    expect(screen.getByText(/couldn’t be read automatically/i)).toBeInTheDocument()
  })

  it('lists checks inline for a non-verified verdict, with the expected/found pair', () => {
    render(<DocCheck doc={doc({ analysisStatus: 'done', analysis: analysis() as never })} />)
    expect(screen.getByText('Needs a reviewer')).toBeInTheDocument()
    expect(screen.getByText(/mismatch/)).toBeInTheDocument()
    expect(screen.getByText('ABC')).toBeInTheDocument()
    expect(screen.getByText('XYZ')).toBeInTheDocument()
    // Read-off fields rendered under their labels.
    expect(screen.getByText('ABC123')).toBeInTheDocument()
  })

  it('collapses the passed checks behind a details summary when verified', () => {
    render(
      <DocCheck
        doc={doc({
          analysisStatus: 'done',
          analysis: analysis({ verdict: 'verified', checks: [{ field: 'name', status: 'pass', message: 'ok', expected: 'A', found: 'A' }] }) as never,
        })}
      />
    )
    expect(screen.getByText('Checked automatically')).toBeInTheDocument()
    expect(screen.getByText('The check passed')).toBeInTheDocument()
  })

  it('flags a stale result when the analysis predates the owner’s answers', () => {
    render(<DocCheck doc={doc({ analysisStatus: 'done', current: false, analysis: analysis() as never })} />)
    expect(screen.getByText('Out of date')).toBeInTheDocument()
  })

  it('renders only the owner’s note when there is no analysis', () => {
    render(<DocCheck doc={doc({ ownerNote: 'Scanned copy' })} />)
    expect(screen.getByText('Scanned copy')).toBeInTheDocument()
    expect(screen.queryByText('Automatic check')).toBeNull()
  })
})
