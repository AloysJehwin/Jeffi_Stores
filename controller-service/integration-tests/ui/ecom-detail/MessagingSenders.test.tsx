import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// The two heavy children (each with their own fetch/dialog wiring) are stubbed: this component is a
// composition, so we verify the add-on summary, group headings and that a card is rendered per channel.
vi.mock('@/components/admin/messaging/SenderCard', () => ({
  default: ({ channel, audience }: { channel: string; audience: string }) => <div data-testid="sender-card">{`${audience}:${channel}`}</div>,
  CHANNEL_LABEL: { sms: 'SMS', whatsapp: 'WhatsApp' },
  day: (v: string) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
}))
vi.mock('@/components/admin/messaging/NumberBuyPanel', () => ({
  default: () => <div data-testid="buy-panel" />,
}))

import MessagingSenders from '@controller/components/admin/ecom/detail/MessagingSenders'
import type { MessagingAddonStatus } from '@/lib/billing/messaging-addon'

const addon = (over: Partial<MessagingAddonStatus> = {}): MessagingAddonStatus =>
  ({ active: true, tier: 'both', until: '2026-12-31T00:00:00Z', ...over }) as unknown as MessagingAddonStatus

const props = (a: MessagingAddonStatus) => ({
  tenantId: 't1',
  storeName: 'Acme',
  addon: a,
  senders: [] as any[],
  entitlement: { sms: 'active', whatsapp: 'active' } as any,
})

describe('MessagingSenders (render + branches)', () => {
  it('shows the bought add-on tier and paid-until date', () => {
    render(<MessagingSenders {...props(addon())} />)
    expect(screen.getByText('SMS & WhatsApp')).toBeInTheDocument()
    expect(screen.getByText('Paid until')).toBeInTheDocument()
  })

  it('shows "Not bought" and "Ended" for a tier of none', () => {
    render(<MessagingSenders {...props(addon({ active: false, tier: 'none', until: null }))} />)
    expect(screen.getByText('Not bought')).toBeInTheDocument()
    expect(screen.getByText('Ended')).toBeInTheDocument()
  })

  it('renders both audience groups and a sender card per channel', () => {
    render(<MessagingSenders {...props(addon())} />)
    expect(screen.getByText('Customer-facing')).toBeInTheDocument()
    expect(screen.getByText('Admin-facing')).toBeInTheDocument()
    // customer: sms + whatsapp, admin: whatsapp -> at least 3 cards.
    expect(screen.getAllByTestId('sender-card').length).toBeGreaterThanOrEqual(3)
  })
})
