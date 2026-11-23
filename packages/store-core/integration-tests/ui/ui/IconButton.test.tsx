import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Trash2 } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'

// next/link -> plain anchor so the in-app link branch renders in happy-dom.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

describe('IconButton (render + variants)', () => {
  it('renders a button with the label as aria-label and fires onClick', () => {
    const onClick = vi.fn()
    render(<IconButton icon={Trash2} label="Delete" onClick={onClick} />)
    const btn = screen.getByRole('button', { name: 'Delete' })
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('disables the button and blocks clicks when disabled', () => {
    const onClick = vi.fn()
    render(<IconButton icon={Trash2} label="Delete" onClick={onClick} disabled />)
    const btn = screen.getByRole('button', { name: 'Delete' })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('shows a spinner and disables when busy', () => {
    render(<IconButton icon={Trash2} label="Saving" onClick={() => {}} busy />)
    expect(screen.getByRole('button', { name: 'Saving' })).toBeDisabled()
  })

  it('renders an in-app href as a link (not a button)', () => {
    render(<IconButton icon={Trash2} label="Open" href="/admin/orders" />)
    const link = screen.getByRole('link', { name: 'Open' })
    expect(link).toHaveAttribute('href', '/admin/orders')
  })

  it('renders a plain anchor for an external/download href with rel on new tab', () => {
    render(<IconButton icon={Trash2} label="Download" href="/api/export.csv" download target="_blank" />)
    const link = screen.getByRole('link', { name: 'Download' })
    expect(link).toHaveAttribute('href', '/api/export.csv')
    expect(link).toHaveAttribute('rel', 'noopener')
    expect(link).toHaveAttribute('download')
  })

  it('falls back to a button when href is given but disabled', () => {
    render(<IconButton icon={Trash2} label="Open" href="/x" disabled />)
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
