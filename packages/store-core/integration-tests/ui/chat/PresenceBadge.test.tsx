import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PresenceBadge from '@/components/chat/PresenceBadge'

// isActive: lastSeen within PRESENCE_TTL_MS (45s) => "in the chat"; older => "away"; null => "not seen yet".

describe('PresenceBadge', () => {
  it('shows "in the chat" for a recent heartbeat', () => {
    render(<PresenceBadge lastSeenAt={new Date().toISOString()} />)
    expect(screen.getByText('Customer in the chat')).toBeInTheDocument()
  })

  it('shows "away" with an elapsed label for a stale heartbeat', () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    render(<PresenceBadge lastSeenAt={tenMinAgo} who="Riya" />)
    expect(screen.getByText(/Riya away · \d+m/)).toBeInTheDocument()
  })

  it('shows "not seen yet" when lastSeenAt is null', () => {
    render(<PresenceBadge lastSeenAt={null} who="Agent" />)
    expect(screen.getByText('Agent not seen yet')).toBeInTheDocument()
  })

  it('compact mode renders only a dot carrying the label via aria-label/title', () => {
    render(<PresenceBadge lastSeenAt={new Date().toISOString()} compact />)
    // No visible text node in compact mode, only the labelled dot.
    expect(screen.queryByText('Customer in the chat')).toBeNull()
    expect(screen.getByLabelText('Customer in the chat')).toBeInTheDocument()
  })
})
