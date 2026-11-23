import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { TenantDetailData } from '@controller/lib/ecom/detail'
import CostSummary from '@controller/components/admin/ecom/detail/CostSummary'

const base = (over: Partial<{ cost: TenantDetailData['cost']; row: TenantDetailData['row'] }> = {}) =>
  ({
    cost: { priceMonth: 2000, priceHour: 3.5, awsMonth: 1200, marginMonth: 800, mtdEstimate: 600 },
    row: { price_inr_month: 2500, compute_status: 'applied', wallet_balance: 0 },
    ...over,
  }) as unknown as TenantDetailData

describe('CostSummary (render + branches)', () => {
  it('shows the empty note when nothing is priced', () => {
    render(<CostSummary d={base({ cost: { priceMonth: null, priceHour: null, awsMonth: null, marginMonth: null, mtdEstimate: null } as TenantDetailData['cost'], row: null })} />)
    expect(screen.getByText(/nothing to price/)).toBeInTheDocument()
  })

  it('prefers the stored subscription price and renders every field', () => {
    render(<CostSummary d={base()} />)
    // row.price_inr_month (2500) wins over cost.priceMonth (2000).
    expect(screen.getByText('₹2,500')).toBeInTheDocument()
    expect(screen.getByText('Price / month')).toBeInTheDocument()
    expect(screen.getByText('AWS / month')).toBeInTheDocument()
    expect(screen.getByText('Margin / month')).toBeInTheDocument()
    expect(screen.getByText(/est\./)).toBeInTheDocument()
    expect(screen.getByText('applied')).toBeInTheDocument()
  })

  it('falls back to cost.priceMonth when the row has none', () => {
    render(<CostSummary d={base({ row: { price_inr_month: null, compute_status: null, wallet_balance: 0 } as unknown as TenantDetailData['row'] })} />)
    expect(screen.getByText('₹2,000')).toBeInTheDocument()
  })
})
