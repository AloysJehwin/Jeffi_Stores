import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn<(...a: any[]) => any>() }),
  usePathname: () => '/admin/ecom/t1',
  useSearchParams: () => new URLSearchParams(),
}))

import CommerceTab from '@controller/components/admin/ecom/tabs/CommerceTab'

const paging = { page: 1, pageSize: 20, param: 'tp' }
const billing = (over: Record<string, unknown> = {}) =>
  ({
    transactionCount: 1200,
    ledgerCount: 0,
    balance: 5000,
    totals: { gross: 100000, codGross: 25000, commission: 3000, fees: 2000, tenantShare: 95000 },
    transactions: [],
    ledger: [],
    ...over,
  }) as any
const bank = (over: Record<string, unknown> = {}) =>
  ({ verification_status: 'verified', holder_name: 'Acme Traders', verified_name: 'ACME TRADERS', account_number: '123456789012', ifsc: 'HDFC0001234', upi_id: null, ...over }) as any

const view = (b: any, k: any) => render(<CommerceTab tenant={{ id: 't1' } as any} billing={b} bank={k} txPage={paging} ledgerPage={{ ...paging, param: 'lp' }} />)

describe('CommerceTab', () => {
  it('summarises money, prepaid vs COD and a positive settlement balance', () => {
    view(billing(), bank())
    expect(screen.getByText('GMV')).toBeInTheDocument()
    expect(screen.getByText('₹1,00,000.00')).toBeInTheDocument()
    expect(screen.getByText('Prepaid').nextSibling).toHaveTextContent('₹75,000.00')
    expect(screen.getByText('COD').nextSibling).toHaveTextContent('₹25,000.00')
    expect(screen.getByText('Transactions', { selector: 'div' }).nextSibling).toHaveTextContent('1,200')
    expect(screen.getByText('Settlement balance').nextSibling).toHaveClass('text-green-600')
    expect(screen.getByText('Settlement ledger')).toBeInTheDocument()
  })

  it('marks a negative settlement balance as bad', () => {
    view(billing({ balance: -250 }), bank())
    expect(screen.getByText('Settlement balance').nextSibling).toHaveClass('text-red-600')
  })

  it('says there is nothing to settle without transactions, and no tables', () => {
    const { unmount } = view(null, bank())
    expect(screen.getByText(/nothing to settle/)).toBeInTheDocument()
    expect(screen.queryByText('Settlement ledger')).toBeNull()
    unmount()
    view(billing({ transactionCount: 0 }), bank())
    expect(screen.getByText(/nothing to settle/)).toBeInTheDocument()
  })

  it('masks the account number and shows the verified holder', () => {
    view(billing(), bank({ upi_id: 'acme@okhdfc' }))
    expect(screen.getByText('••••9012')).toBeInTheDocument()
    expect(screen.queryByText('123456789012')).toBeNull()
    expect(screen.getByText('HDFC0001234')).toBeInTheDocument()
    expect(screen.getByText('acme@okhdfc')).toBeInTheDocument()
  })

  it('flags a holder name that differs from the bank-returned name', () => {
    view(billing(), bank())
    expect(screen.getByText('Name mismatch')).toBeInTheDocument()
    expect(screen.getByText(/entered “Acme Traders”, bank returned “ACME TRADERS”/)).toBeInTheDocument()
  })

  it('warns that settlements cannot be released without a payout account', () => {
    view(billing(), null)
    expect(screen.getByText(/No payout account on file/)).toBeInTheDocument()
  })
})
