import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn<(...a: any[]) => any>() }),
  usePathname: () => '/admin/ecom/t1/billing',
  useSearchParams: () => new URLSearchParams(),
}))

import { TransactionsTable, LedgerTable, WalletTable } from '@controller/components/admin/ecom/detail/BillingTables'
import type { LedgerEntry, TenantTransaction } from '@/lib/tenant-registry/tenants'
import type { WalletLedgerEntry } from '@/lib/payments/wallet'

const paging = { page: 1, pageSize: 20, param: 'tp' }

describe('TransactionsTable (render + branches)', () => {
  it('renders the empty message', () => {
    render(<TransactionsTable rows={[]} total={0} paging={paging} />)
    expect(screen.getByText('No transactions yet.')).toBeInTheDocument()
  })

  it('renders a transaction row with its order and mode', () => {
    const rows = [
      { id: 'tx1', order_ref: 'ORD-9', gross_amount: '1000', tenant_share: '900', platform_commission: '80', gateway_fee: '20', is_cod: true, status: 'captured', occurred_at: '2026-11-20T00:00:00Z' },
    ] as unknown as TenantTransaction[]
    render(<TransactionsTable rows={rows} total={1} paging={paging} />)
    expect(screen.getAllByText('ORD-9').length).toBeGreaterThan(0)
    expect(screen.getAllByText('COD').length).toBeGreaterThan(0)
  })
})

describe('LedgerTable (render + branches + balance)', () => {
  it('renders the empty message and the balance footer', () => {
    render(<LedgerTable rows={[]} total={0} balance={1250} paging={{ ...paging, param: 'lp' }} />)
    expect(screen.getByText('No ledger entries yet.')).toBeInTheDocument()
    expect(screen.getByText('Balance')).toBeInTheDocument()
    expect(screen.getByText('₹1,250.00')).toBeInTheDocument()
  })

  it('labels a known entry type and shows a signed amount', () => {
    const rows = [
      { id: 'l1', entry_type: 'commission', note: 'n', amount: '-50', occurred_at: '2026-11-20T00:00:00Z' },
    ] as unknown as LedgerEntry[]
    render(<LedgerTable rows={rows} total={1} balance={0} paging={{ ...paging, param: 'lp' }} />)
    expect(screen.getAllByText('Platform commission').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/−₹50/).length).toBeGreaterThan(0)
  })
})

describe('WalletTable (render + branches)', () => {
  it('renders the empty message', () => {
    render(<WalletTable rows={[]} paging={{ ...paging, param: 'wp' }} hasNext={false} />)
    expect(screen.getByText('No wallet movements yet.')).toBeInTheDocument()
  })

  it('labels a wallet category from the map', () => {
    const rows = [
      { category: 'goodwill_credit', entry_type: 'credit', amount: '200', occurred_at: '2026-11-20T00:00:00Z', order_ref: null, awb: null, note: 'Goodwill' },
    ] as unknown as WalletLedgerEntry[]
    render(<WalletTable rows={rows} paging={{ ...paging, param: 'wp' }} hasNext={false} />)
    expect(screen.getAllByText('Platform credit').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/\+₹200/).length).toBeGreaterThan(0)
  })
})
