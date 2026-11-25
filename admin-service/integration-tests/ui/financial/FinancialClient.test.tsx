import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => sp }))

const { stub } = vi.hoisted(() => ({ stub: (name: string) => ({ [name]: (p: any) => <div>{`${name}${p?.initialData !== undefined ? `:${JSON.stringify(p.initialData)}` : ''}`}</div> }) }))
vi.mock('@admin/app/(admin)/admin/financial/_components/OverviewTab', () => stub('OverviewTab'))
vi.mock('@admin/app/(admin)/admin/financial/_components/ReceivablesTab', () => stub('ReceivablesTab'))
vi.mock('@admin/app/(admin)/admin/financial/_components/PayablesTab', () => stub('PayablesTab'))
vi.mock('@admin/app/(admin)/admin/financial/_components/TransactionsTab', () => stub('TransactionsTab'))
vi.mock('@admin/app/(admin)/admin/financial/_components/PLTab', () => stub('PLTab'))
vi.mock('@admin/app/(admin)/admin/financial/_components/CashflowTab', () => stub('CashflowTab'))
vi.mock('@admin/app/(admin)/admin/financial/_components/CodRemittanceTab', () => stub('CodRemittanceTab'))
vi.mock('@admin/app/(admin)/admin/financial/_components/MessagingTab', () => stub('MessagingTab'))
vi.mock('@admin/app/(admin)/admin/financial/_components/AiCostsTab', () => stub('AiCostsTab'))
vi.mock('@admin/app/(admin)/admin/financial/_components/DisputesTab', () => stub('DisputesTab'))
vi.mock('@admin/app/(admin)/admin/financial/_components/RazorpaySettlementsTab', () => stub('RazorpaySettlementsTab'))
vi.mock('@admin/app/(admin)/admin/financial/_components/RoutePayoutsTab', () => ({ RoutePayoutsTab: (p: any) => <div>RoutePayoutsTab:{String(p.ownPending)}</div> }))
vi.mock('@admin/app/(admin)/admin/financial/_components/MarketplaceSettlementsTab', () => stub('MarketplaceSettlementsTab'))

import FinancialClient from '@admin/app/(admin)/admin/financial/FinancialClient'

const fetchMock = vi.fn()

describe('FinancialClient', () => {
  beforeEach(() => {
    sp = new URLSearchParams()
    fetchMock.mockReset()
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({ json: async () => (url.includes('payables') ? { rows: [1] } : url.includes('/pl') ? { pl: true } : url.includes('cashflow') ? { cf: true } : { txns: [] }) })
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  it('opens on Overview and prefetches payables, transactions, P&L and cashflow once', async () => {
    render(<FinancialClient razorpayTab={null} />)
    expect(screen.getByText('OverviewTab')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    const urls = fetchMock.mock.calls.map(c => c[0] as string)
    expect(urls).toContain('/api/admin/financial/payables')
    expect(urls.some(u => /\/pl\?from=\d{4}-04-01&to=\d{4}-03-31/.test(u))).toBe(true)
  })

  it('hides the Razorpay tab when there is no razorpay config', () => {
    render(<FinancialClient razorpayTab={null} />)
    expect(screen.queryByRole('tab', { name: /Razorpay|Settlements/ })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'AI costs' })).toBeInTheDocument()
  })

  it('shows Razorpay settlements for a direct merchant', () => {
    sp = new URLSearchParams('tab=razorpay')
    render(<FinancialClient razorpayTab={{ route: false, ownPending: false }} />)
    expect(screen.getByRole('tab', { name: 'Razorpay settlements' })).toBeInTheDocument()
    expect(screen.getByText('RazorpaySettlementsTab')).toBeInTheDocument()
  })

  it('a route merchant gets Settlements with the route payouts tab', () => {
    sp = new URLSearchParams('tab=razorpay')
    render(<FinancialClient razorpayTab={{ route: true, ownPending: true }} />)
    expect(screen.getByRole('tab', { name: 'Settlements' })).toBeInTheDocument()
    expect(screen.getByText('RoutePayoutsTab:true')).toBeInTheDocument()
  })

  it('clicking a tab switches the body and pushes the URL', async () => {
    render(<FinancialClient razorpayTab={null} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Disputes' }))
    expect(screen.getByText('DisputesTab')).toBeInTheDocument()
    expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/financial?tab=disputes'), { scroll: false })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  })

  it('hands the prefetched payables to the Payables tab', async () => {
    sp = new URLSearchParams('tab=payables')
    render(<FinancialClient razorpayTab={null} />)
    await waitFor(() => expect(screen.getByText('PayablesTab:{"rows":[1]}')).toBeInTheDocument())
  })

  it('ignores an unknown ?tab and falls back to Overview', async () => {
    sp = new URLSearchParams('tab=nope')
    render(<FinancialClient razorpayTab={null} />)
    expect(screen.getByText('OverviewTab')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  })
})
