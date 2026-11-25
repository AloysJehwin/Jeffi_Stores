import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import ConnectionsGear, { NotConnectedState } from '@/components/admin/ConnectionsGear'

describe('ConnectionsGear', () => {
  beforeEach(() => {
    canWrite = true
  })

  it.each([
    ['connected', 'Connected'],
    ['pending', 'Choose an account to finish connecting'],
    ['none', 'Not connected'],
  ] as const)('labels the gear for the %s state', (state, text) => {
    render(
      <ConnectionsGear title="Amazon Ads" scope="amazon_ads" state={state} open={false} onOpenChange={vi.fn()}>
        body
      </ConnectionsGear>
    )
    expect(screen.getByRole('button', { name: `Amazon Ads (${text})` })).toBeInTheDocument()
  })

  it('opens via the gear and does not render the dialog while closed', () => {
    const onOpenChange = vi.fn()
    render(
      <ConnectionsGear title="Amazon Ads" scope="amazon_ads" state="none" open={false} onOpenChange={onOpenChange}>
        panel
      </ConnectionsGear>
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('shows the dialog with title, state and children when open', () => {
    render(
      <ConnectionsGear title="Amazon Ads" scope="amazon_ads" state="connected" open onOpenChange={vi.fn()}>
        <p>connection panel</p>
      </ConnectionsGear>
    )
    const dialog = screen.getByRole('dialog', { name: 'Amazon Ads' })
    expect(dialog).toHaveTextContent('Connected')
    expect(screen.getByText('connection panel')).toBeInTheDocument()
    expect(screen.queryByText(/View only/)).toBeNull()
  })

  it('closes from the X button, the backdrop and Escape, but not from inside the dialog', () => {
    const onOpenChange = vi.fn()
    render(
      <ConnectionsGear title="T" scope="s" state="none" open onOpenChange={onOpenChange}>
        <p>inner</p>
      </ConnectionsGear>
    )
    fireEvent.click(screen.getByText('inner'))
    expect(onOpenChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(onOpenChange).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledTimes(3)
  })

  it('ignores Escape while closed', () => {
    const onOpenChange = vi.fn()
    render(
      <ConnectionsGear title="T" scope="s" state="none" open={false} onOpenChange={onOpenChange}>
        x
      </ConnectionsGear>
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('shows a view-only note without write access', () => {
    canWrite = false
    render(
      <ConnectionsGear title="T" scope="s" state="none" open onOpenChange={vi.fn()}>
        x
      </ConnectionsGear>
    )
    expect(screen.getByText(/View only/)).toBeInTheDocument()
  })
})

describe('NotConnectedState', () => {
  it('names the provider and opens the connection dialog', () => {
    const onOpen = vi.fn()
    render(<NotConnectedState provider="Meta" onOpen={onOpen} />)
    expect(screen.getByText(/connect your Meta account/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Connect/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
