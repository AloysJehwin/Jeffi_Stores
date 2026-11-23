import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Plus } from 'lucide-react'
import { ActionButton, DetailHeader, CopyValue, type KitAction } from '@/components/admin/kit/actions'

// next/link -> anchor; the confirm + write-scope contexts are mocked so the button logic runs
// without providers. useCanWrite returns `allow` from the module-level flag; useConfirm resolves
// `confirmResult`.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

let allow = true
let confirmResult = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => allow }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(confirmResult) }))

describe('ActionButton (render + branches)', () => {
  it('renders a link when href is set and the action is enabled', () => {
    const action: KitAction = { label: 'New', href: '/admin/x/new', icon: Plus }
    render(<ActionButton action={action} />)
    const link = screen.getByRole('link', { name: /New/ })
    expect(link).toHaveAttribute('href', '/admin/x/new')
  })

  it('fires onClick for a button action', async () => {
    const onClick = vi.fn<(...a: any[]) => any>()
    render(<ActionButton action={{ label: 'Run', onClick }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await vi.waitFor(() => expect(onClick).toHaveBeenCalledTimes(1))
  })

  it('disables the button (not a link) when scope is denied', () => {
    allow = false
    render(<ActionButton action={{ label: 'Delete', href: '/x', onClick: () => {}, scope: 'orders.write' }} />)
    const btn = screen.getByRole('button', { name: 'Delete' })
    expect(btn).toBeDisabled()
    expect(screen.queryByRole('link')).toBeNull()
    allow = true
  })

  it('skips onClick when the confirm dialog is cancelled', async () => {
    confirmResult = false
    const onClick = vi.fn<(...a: any[]) => any>()
    render(<ActionButton action={{ label: 'Wipe', onClick, confirm: 'Sure?' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Wipe' }))
    await Promise.resolve()
    await Promise.resolve()
    expect(onClick).not.toHaveBeenCalled()
    confirmResult = true
  })

  it('respects an explicit disabled flag', () => {
    render(<ActionButton action={{ label: 'Nope', onClick: () => {}, disabled: true }} />)
    expect(screen.getByRole('button', { name: 'Nope' })).toBeDisabled()
  })
})

describe('DetailHeader (render)', () => {
  it('renders title, subtitle, back link, identifiers and a primary action', () => {
    render(
      <DetailHeader
        title="Order #42"
        subtitle="Placed today"
        back={{ href: '/admin/orders', label: 'Orders' }}
        identifiers={[{ label: 'Ref', value: 'ORD-42' }]}
        primary={{ label: 'Refund', onClick: () => {} }}
      />
    )
    expect(screen.getByRole('heading', { name: 'Order #42' })).toBeInTheDocument()
    expect(screen.getByText('Placed today')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Orders/ })).toHaveAttribute('href', '/admin/orders')
    expect(screen.getByText('ORD-42')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refund' })).toBeInTheDocument()
  })

  it('renders a copy button for an identifier marked copy', () => {
    render(<DetailHeader title="X" identifiers={[{ label: 'Id', value: 'abc', copy: true }]} />)
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })
})

describe('CopyValue', () => {
  it('writes the value to the clipboard on click', () => {
    const writeText = vi.fn<(...a: any[]) => any>().mockResolvedValue(undefined)
    // happy-dom may not define clipboard; install a stub.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<CopyValue value="SKU-9" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('SKU-9')
  })
})
