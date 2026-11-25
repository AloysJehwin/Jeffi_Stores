import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const push = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => sp }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('@admin/app/(admin)/admin/purchase-orders/_components/PurchaseOrdersOverview', () => ({ default: () => <div>overview-body</div> }))
vi.mock('@admin/app/(admin)/admin/purchase-orders/_components/PurchaseOrdersTab', () => ({ default: ({ initialPO }: any) => <div>orders-body:{initialPO ?? 'none'}</div> }))
vi.mock('@admin/app/(admin)/admin/purchase-orders/_components/PurchaseOrderDrafts', () => ({ default: () => <div>po-drafts</div> }))
vi.mock('@/components/admin/drafts/PageDrafts', () => ({
  default: ({ children }: any) => <div>drafts-wrap{children}</div>,
  DraftsTabLabel: () => <span>Drafts</span>,
}))

import PurchaseOrdersClient from '@admin/app/(admin)/admin/purchase-orders/_components/PurchaseOrdersClient'

describe('PurchaseOrdersClient', () => {
  beforeEach(() => {
    sp = new URLSearchParams()
  })

  it('defaults to the overview tab', () => {
    render(asAdmin(<PurchaseOrdersClient />))
    expect(screen.getByText('overview-body')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Purchase orders' })).toBeInTheDocument()
  })

  it('a ?po= deep link opens the list on that order', () => {
    sp = new URLSearchParams('po=PO-17')
    render(asAdmin(<PurchaseOrdersClient />))
    expect(screen.getByText('orders-body:PO-17')).toBeInTheDocument()
  })

  it('renders the drafts tab with the PO drafts list', () => {
    sp = new URLSearchParams('tab=drafts')
    render(asAdmin(<PurchaseOrdersClient />))
    expect(screen.getByText('po-drafts')).toBeInTheDocument()
  })

  it('clicking a tab pushes its URL without scrolling', () => {
    render(asAdmin(<PurchaseOrdersClient />))
    fireEvent.click(screen.getByRole('tab', { name: 'Purchase orders' }))
    expect(push.mock.calls[0][0]).toContain('/admin/purchase-orders')
    expect(push.mock.calls[0][0]).toContain('tab=orders')
    expect(push.mock.calls[0][1]).toEqual({ scroll: false })
  })

  it('gates the New purchase order action on inventory write', () => {
    const { unmount } = render(asAdmin(<PurchaseOrdersClient />))
    expect(screen.getByRole('link', { name: 'New purchase order' })).toBeInTheDocument()
    unmount()
    render(asMember(<PurchaseOrdersClient />, []))
    expect(screen.queryByRole('link', { name: 'New purchase order' })).not.toBeInTheDocument()
  })
})
