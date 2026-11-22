import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import MessageList from '@/components/chat/MessageList'
import type { SupportMessage } from '@/lib/support/types'

// happy-dom doesn't implement Element.scrollTo; the list auto-scrolls on mount, so stub it.
beforeAll(() => {
  if (!(Element.prototype as any).scrollTo) {
    ;(Element.prototype as any).scrollTo = vi.fn()
  }
})

const msg = (over: Partial<SupportMessage> = {}): SupportMessage => ({
  id: Math.random().toString(36).slice(2),
  sessionId: 's1',
  sender: 'customer',
  senderName: 'Riya',
  text: 'hi',
  original: null,
  lang: 'en',
  at: '2026-01-05T10:00:00.000Z',
  status: 'sent',
  channel: 'web',
  payloads: [],
  attachments: [],
  clientId: null,
  ...over,
})

describe('MessageList', () => {
  it('renders the empty slot when there are no messages', () => {
    render(<MessageList messages={[]} isMine={() => false} empty={<div>No messages yet</div>} />)
    expect(screen.getByText('No messages yet')).toBeInTheDocument()
  })

  it('renders each message bubble', () => {
    const messages = [msg({ text: 'first' }), msg({ text: 'second' })]
    render(<MessageList messages={messages} isMine={() => false} />)
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
  })

  it('renders the footer slot (e.g. typing dots) under the list', () => {
    render(<MessageList messages={[msg()]} isMine={() => false} footer={<div>typing-footer</div>} />)
    expect(screen.getByText('typing-footer')).toBeInTheDocument()
  })

  it('shows a day separator for the first message', () => {
    render(<MessageList messages={[msg({ at: '2026-01-05T10:00:00.000Z' })]} isMine={() => false} />)
    // dayLabel renders an absolute date ("5 January") for old messages (not Today/Yesterday).
    expect(screen.getByText('5 January')).toBeInTheDocument()
  })

  it('applies a sender label through labelFor', () => {
    render(<MessageList messages={[msg({ text: 'labelled' })]} isMine={() => false} labelFor={() => 'Agent Sam'} />)
    expect(screen.getByText('Agent Sam')).toBeInTheDocument()
  })
})
