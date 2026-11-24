import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const push = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => sp }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('@admin/app/(admin)/admin/suppliers/_components/SuppliersOverview', () => ({ default: () => <div>overview-body</div> }))
vi.mock('@admin/app/(admin)/admin/suppliers/_components/SuppliersTab', () => ({ default: () => <div>suppliers-body</div> }))
vi.mock('@/components/admin/drafts/PageDrafts', () => ({
  default: ({ type }: any) => <div>drafts-body:{type}</div>,
  DraftsTabLabel: () => <span>Drafts</span>,
}))

import SuppliersClient from '@admin/app/(admin)/admin/suppliers/_components/SuppliersClient'

describe('SuppliersClient', () => {
  beforeEach(() => {
    sp = new URLSearchParams()
  })

  it('opens on the overview with the three tabs', () => {
    render(asAdmin(<SuppliersClient />))
    expect(screen.getByText('overview-body')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Suppliers' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Drafts' })).toBeInTheDocument()
  })

  it('shows the suppliers tab for ?tab=suppliers and the drafts tab for ?tab=drafts', () => {
    sp = new URLSearchParams('tab=suppliers')
    const { unmount } = render(asAdmin(<SuppliersClient />))
    expect(screen.getByText('suppliers-body')).toBeInTheDocument()
    unmount()
    sp = new URLSearchParams('tab=drafts')
    render(asAdmin(<SuppliersClient />))
    expect(screen.getByText('drafts-body:supplier')).toBeInTheDocument()
  })

  it('switching to Suppliers pushes the list URL', () => {
    render(asAdmin(<SuppliersClient />))
    fireEvent.click(screen.getByRole('tab', { name: 'Suppliers' }))
    expect(push).toHaveBeenCalledTimes(1)
    const [url, opts] = push.mock.calls[0]
    expect(url).toContain('/admin/suppliers')
    expect(url).toContain('tab=suppliers')
    expect(opts).toEqual({ scroll: false })
  })

  it('switching to Drafts pushes the drafts tab', () => {
    render(asAdmin(<SuppliersClient />))
    fireEvent.click(screen.getByRole('tab', { name: 'Drafts' }))
    expect(push.mock.calls[0][0]).toContain('tab=drafts')
  })

  it('offers New supplier only with the inventory write scope', () => {
    const { unmount } = render(asAdmin(<SuppliersClient />))
    expect(screen.getByRole('link', { name: 'New supplier' })).toHaveAttribute('href', expect.stringContaining('/admin/suppliers/new'))
    unmount()
    render(asMember(<SuppliersClient />, ['inventory:read']))
    expect(screen.queryByRole('link', { name: 'New supplier' })).not.toBeInTheDocument()
  })
})
