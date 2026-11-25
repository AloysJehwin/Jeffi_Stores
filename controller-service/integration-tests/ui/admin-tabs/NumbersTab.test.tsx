import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@controller/components/admin/ecom/detail/MessagingSenders', () => ({
  default: (p: any) => (
    <div data-testid="senders">
      {p.tenantId}|{p.storeName}|{p.senders.length}|{p.entitlement.allowed ? 'allowed' : 'blocked'}
    </div>
  ),
}))
const getMessagingAddon = vi.fn<(...a: any[]) => any>()
const listTenantSenders = vi.fn<(...a: any[]) => any>()
const messagingEntitlement = vi.fn<(...a: any[]) => any>()
vi.mock('@/lib/messaging/tenant-senders', () => ({ listTenantSenders: (...a: any[]) => listTenantSenders(...a) }))
vi.mock('@/lib/billing/messaging-addon', () => ({
  getMessagingAddon: (...a: any[]) => getMessagingAddon(...a),
  messagingEntitlement: (...a: any[]) => messagingEntitlement(...a),
}))

import NumbersTab from '@controller/components/admin/ecom/tabs/NumbersTab'

describe('NumbersTab (server component)', () => {
  beforeEach(() => {
    getMessagingAddon.mockResolvedValue({ status: 'active' })
    listTenantSenders.mockResolvedValue([{ id: 's1' }, { id: 's2' }])
    messagingEntitlement.mockResolvedValue({ allowed: true })
  })

  it('loads add-on, senders and a fresh entitlement and hands them to the senders panel', async () => {
    render(await NumbersTab({ tenantId: 'acme', storeName: 'Acme Store' }))
    expect(screen.getByText('SMS & WhatsApp numbers')).toBeInTheDocument()
    expect(screen.getByTestId('senders')).toHaveTextContent('acme|Acme Store|2|allowed')
    expect(messagingEntitlement).toHaveBeenCalledWith('acme', { maxAgeMs: 0 })
  })

  it('shows a retry hint when any lookup fails', async () => {
    listTenantSenders.mockRejectedValue(new Error('db down'))
    render(await NumbersTab({ tenantId: 'acme', storeName: 'Acme Store' }))
    expect(screen.getByText(/Could not load this store's messaging senders/)).toBeInTheDocument()
    expect(screen.queryByTestId('senders')).toBeNull()
  })
})
