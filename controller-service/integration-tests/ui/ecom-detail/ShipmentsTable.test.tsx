import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn<(...a: any[]) => any>(), push: vi.fn<(...a: any[]) => any>() }),
  usePathname: () => '/admin/ecom/t1',
  useSearchParams: () => new URLSearchParams(),
}))

import ShipmentsTable from '@controller/components/admin/ecom/detail/ShipmentsTable'
import type { ShipmentRow } from '@controller/lib/orders/tenant-shipments-shared'

const shipments = (): ShipmentRow[] =>
  [
    { id: 's1', order_number: 'ORD-1', awb_number: 'AWB111', payment_mode: 'prepaid', shipping_amount: '80', delhivery_billed_amount: '95', delhivery_extra_charge: '15', delhivery_billed_at: '2026-11-19T00:00:00Z', shipment_status: 'delivered' },
    { id: 's2', order_number: 'ORD-2', awb_number: 'AWB222', payment_mode: 'cod', shipping_amount: '60', delhivery_billed_amount: null, delhivery_extra_charge: null, delhivery_billed_at: null, shipment_status: null },
  ] as unknown as ShipmentRow[]

describe('ShipmentsTable (render + branches)', () => {
  it('renders the empty message with no shipments', () => {
    render(<ShipmentsTable tenantId="t1" ownDelhivery={false} shipments={[]} />)
    expect(screen.getByText(/No shipments with an AWB yet/)).toBeInTheDocument()
  })

  it('lists orders, AWBs and the extra-charge delta', () => {
    render(<ShipmentsTable tenantId="t1" ownDelhivery={false} shipments={shipments()} />)
    expect(screen.getAllByText('ORD-1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('AWB111').length).toBeGreaterThan(0)
    expect(screen.getAllByText('COD').length).toBeGreaterThan(0)
    // +₹15 extra on the first shipment.
    expect(screen.getAllByText(/\+₹15/).length).toBeGreaterThan(0)
  })
})
