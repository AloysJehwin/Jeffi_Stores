import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@controller/components/admin/ecom/detail/ShipmentsTable', () => ({
  default: (p: any) => <div data-testid="table">{p.shipments.length} rows, own={String(p.ownDelhivery)}</div>,
}))
vi.mock('@controller/components/admin/ecom/tabs/BillingReconcile', () => ({ default: ({ tenantId }: any) => <div data-testid="reconcile">reconcile:{tenantId}</div> }))

import ShipmentsTab from '@controller/components/admin/ecom/tabs/ShipmentsTab'

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}` })) as any[]

describe('ShipmentsTab', () => {
  it('on the platform account explains netting and offers billing reconciliation', () => {
    render(<ShipmentsTab tenantId="t1" ownDelhivery={false} shipments={rows(2)} />)
    expect(screen.getByText(/Platform Delhivery: the wallet holds an estimate/)).toBeInTheDocument()
    expect(screen.getByTestId('table')).toHaveTextContent('2 rows, own=false')
    expect(screen.getByText('Delhivery billing reconciliation')).toBeInTheDocument()
    expect(screen.getByTestId('reconcile')).toHaveTextContent('reconcile:t1')
    expect(screen.queryByText('Latest 100 shipments.')).toBeNull()
  })

  it('on the store own account is read-only and hides reconciliation', () => {
    render(<ShipmentsTab tenantId="t1" ownDelhivery shipments={rows(1)} />)
    expect(screen.getByText(/ships on their own Delhivery account/)).toBeInTheDocument()
    expect(screen.queryByText('Delhivery billing reconciliation')).toBeNull()
  })

  it('notes the 100-row cap', () => {
    render(<ShipmentsTab tenantId="t1" ownDelhivery={false} shipments={rows(100)} />)
    expect(screen.getByText('Latest 100 shipments.')).toBeInTheDocument()
  })
})
