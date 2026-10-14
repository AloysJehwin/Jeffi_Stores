import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import RfqTrendChart, { type RfqTrendPoint } from '@/app/(admin)/admin/business/rfqs/_components/RfqTrendChart'

// Seed example for the integration suite — the Business RFQs stats block (fix 50a2cb6f).
// Two parts, because the stats row is split across a renderable child and a non-renderable parent:
//   1. RfqTrendChart IS an exported client component → render it in happy-dom and assert output.
//   2. The overlap fix (lg:h-56 → lg:min-h-56) lives on an inline async SERVER component in page.tsx
//      that queries the DB and can't be rendered in isolation, so it is guarded at the source level.

describe('RfqTrendChart (render)', () => {
  const twelveMonths: RfqTrendPoint[] = Array.from({ length: 12 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    count: i === 5 ? 30 : i === 6 ? 2 : 0,
  }))

  it('renders the header and a bar chart when there is data', () => {
    const { container } = render(<RfqTrendChart data={twelveMonths} />)
    expect(screen.getByText('RFQs Received')).toBeInTheDocument()
    expect(screen.getByText('last 12 months')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'RFQs received per month' })).toBeInTheDocument()
    // One <rect> bar per month point (non-zero months draw a visible bar).
    expect(container.querySelectorAll('rect').length).toBe(twelveMonths.length)
  })

  it('shows the empty state when every month is zero', () => {
    render(<RfqTrendChart data={Array.from({ length: 12 }, (_, i) => ({ month: `2026-${i + 1}`, count: 0 }))} />)
    expect(screen.getByText('No RFQs yet')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'RFQs received per month' })).not.toBeInTheDocument()
  })

  it('tolerates an empty data array without throwing', () => {
    render(<RfqTrendChart data={[]} />)
    expect(screen.getByText('No RFQs yet')).toBeInTheDocument()
  })
})

describe('Business RFQs stats layout (regression guard for 50a2cb6f)', () => {
  const pageSrc = readFileSync(join(process.cwd(), 'controller-service/src/app/(admin)/admin/business/rfqs/page.tsx'), 'utf8')

  // The gradient card holds 6 stat tiles (2–3 rows), taller than a fixed 14rem. A hard lg:h-56
  // clipped it so the bottom tiles overflowed into the search bar. min-h lets the row grow.
  it('uses lg:min-h-56 (grows to fit the stat tiles), not a fixed lg:h-56', () => {
    expect(pageSrc).toMatch(/lg:min-h-56/)
    expect(pageSrc).not.toMatch(/\blg:h-56\b/)
  })
})
