import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ResetToPlatformDialog from '@/components/admin/messaging-templates/ResetToPlatformDialog'

// Diff + warning gate before overwriting a tenant's forked body with the platform default.
// Admin theme -> kit Dialog; ecom theme -> EcomDialogShell. Both render a per-line diff and a
// Cancel / Reset footer wired to onClose / onConfirm.

describe('ResetToPlatformDialog (render + branches)', () => {
  const current = { body: 'Hello friend\nShared line' }
  const platform = { body: 'Hello customer\nShared line' }

  it('renders nothing when closed', () => {
    const { container } = render(
      <ResetToPlatformDialog
        open={false}
        onClose={() => {}}
        onConfirm={() => {}}
        channel="sms"
        current={current}
        platform={platform}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the title, warning banner and both body panels (admin theme)', () => {
    render(
      <ResetToPlatformDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        channel="sms"
        current={current}
        platform={platform}
      />
    )
    expect(screen.getAllByText('Reset to platform default').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/platform catalogue was updated/)).toBeInTheDocument()
    expect(screen.getByText('Current body')).toBeInTheDocument()
    expect(screen.getByText('Platform body')).toBeInTheDocument()
    expect(screen.getByText('Per-line diff')).toBeInTheDocument()
  })

  it('renders the per-line diff with a removed and an added line', () => {
    render(
      <ResetToPlatformDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        channel="sms"
        current={current}
        platform={platform}
      />
    )
    // Changed line shows up as both a "-" (current) and a "+" (platform) entry.
    expect(screen.getByText('Hello friend')).toBeInTheDocument()
    expect(screen.getByText('Hello customer')).toBeInTheDocument()
  })

  it('shows the subject diff only for email when the subject changed', () => {
    const { rerender } = render(
      <ResetToPlatformDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        channel="email"
        current={{ body: 'x', subject: 'Old subject' }}
        platform={{ body: 'x', subject: 'New subject' }}
      />
    )
    expect(screen.getByText('Current subject')).toBeInTheDocument()
    expect(screen.getByText('Platform subject')).toBeInTheDocument()
    // Same subject -> no subject panel.
    rerender(
      <ResetToPlatformDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        channel="email"
        current={{ body: 'x', subject: 'Same' }}
        platform={{ body: 'x', subject: 'Same' }}
      />
    )
    expect(screen.queryByText('Current subject')).not.toBeInTheDocument()
  })

  it('shows the WhatsApp brand-token note only for the whatsapp channel', () => {
    const { rerender } = render(
      <ResetToPlatformDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        channel="sms"
        current={current}
        platform={platform}
      />
    )
    expect(screen.queryByText('{{brand_name}}')).not.toBeInTheDocument()
    rerender(
      <ResetToPlatformDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        channel="whatsapp"
        current={current}
        platform={platform}
      />
    )
    expect(screen.getByText('{{brand_name}}')).toBeInTheDocument()
  })

  it('wires Cancel to onClose and Reset to onConfirm', () => {
    const onClose = vi.fn<() => void>()
    const onConfirm = vi.fn<() => void>()
    render(
      <ResetToPlatformDialog
        open
        onClose={onClose}
        onConfirm={onConfirm}
        channel="sms"
        current={current}
        platform={platform}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to platform default' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('disables the footer buttons while busy', () => {
    render(
      <ResetToPlatformDialog
        open
        busy
        onClose={() => {}}
        onConfirm={() => {}}
        channel="sms"
        current={current}
        platform={platform}
      />
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset to platform default' })).toBeDisabled()
  })

  it('renders in the ecom theme via the ecom dialog shell', () => {
    render(
      <ResetToPlatformDialog
        open
        theme="ecom"
        onClose={() => {}}
        onConfirm={() => {}}
        channel="sms"
        current={current}
        platform={platform}
      />
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Per-line diff')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset to platform default' })).toBeInTheDocument()
  })
})
