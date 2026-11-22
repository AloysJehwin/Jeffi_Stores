import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { InfraDetail } from '@controller/lib/ecom/detail'
import CostBreakdown from '@controller/components/admin/ecom/detail/CostBreakdown'

const withBreakdown = () =>
  ({
    breakdown: {
      quote: {
        lines: [
          { key: 'ec2', label: 'Compute (t4g.medium)', detail: '1 × t4g.medium', awsUsdMonth: 24, inrMonth: 2600 },
          { key: 'rds', label: 'Database', detail: 'db.t4g.micro', awsUsdMonth: 12, inrMonth: 1300 },
        ],
        awsInrMonth: 3000,
        inrMonth: 3900,
        marginInrMonth: 900,
      },
      usdInr: 84,
      margin: 0.25,
      planFee: 499,
      total: { gstOnInfra: 702, planFee: 499, total: 5101 },
    },
    breakdownNote: null,
  }) as unknown as InfraDetail

describe('CostBreakdown (render + branches)', () => {
  it('shows the note when there is no breakdown', () => {
    render(<CostBreakdown infra={{ breakdown: null, breakdownNote: 'No spec chosen yet.' } as unknown as InfraDetail} />)
    expect(screen.getByText('No spec chosen yet.')).toBeInTheDocument()
  })

  it('lists every priced part and the margin percent', () => {
    render(<CostBreakdown infra={withBreakdown()} />)
    expect(screen.getByText('Compute (t4g.medium)')).toBeInTheDocument()
    expect(screen.getByText('Database')).toBeInTheDocument()
    expect(screen.getByText('Infrastructure')).toBeInTheDocument()
    // margin rounded to a whole percent.
    expect(screen.getByText(/\(25%\)/)).toBeInTheDocument()
    expect(screen.getByText('Owner pays / mo')).toBeInTheDocument()
    // total.total formatted in rupees.
    expect(screen.getByText('₹5,101')).toBeInTheDocument()
  })
})
