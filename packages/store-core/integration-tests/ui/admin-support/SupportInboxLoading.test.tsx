import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SupportInboxLoading, { SessionRowsLoading, MessagesLoading, ConversationLoading, INBOX_SPLIT } from '@/components/admin/support/SupportInboxLoading'

describe('SupportInboxLoading', () => {
  it('shows the real filter and channel labels with the placeholder pane', () => {
    render(<SupportInboxLoading />)
    for (const l of ['Needs a person', 'Needs approval', 'Mine', 'Assistant', 'All open', 'Closed', 'All channels', 'Website', 'App', 'WhatsApp', 'Email']) {
      expect(screen.getByText(l)).toBeInTheDocument()
    }
    expect(screen.getByText(/Pick a conversation/)).toBeInTheDocument()
    expect(INBOX_SPLIT).toEqual({ '--admin-split-offset': '12rem' })
  })

  it('SessionRowsLoading renders the requested number of rows', () => {
    const { container } = render(<ul><SessionRowsLoading rows={3} /></ul>)
    expect(container.querySelectorAll('li')).toHaveLength(3)
  })

  it('ConversationLoading is an accessible busy status', () => {
    render(<ConversationLoading />)
    expect(screen.getByRole('status', { name: 'Loading conversation' })).toHaveAttribute('aria-busy', 'true')
  })

  it('MessagesLoading renders message bubbles', () => {
    const { container } = render(<MessagesLoading />)
    expect(container.firstElementChild?.children).toHaveLength(5)
  })
})
