import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MessageBubble from '@/components/chat/MessageBubble'
import type { SupportMessage } from '@/lib/support/types'

const base = (over: Partial<SupportMessage> = {}): SupportMessage => ({
  id: 'm1',
  sessionId: 's1',
  sender: 'customer',
  senderName: 'Riya',
  text: 'Hello there',
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

describe('MessageBubble', () => {
  it('renders plain text', () => {
    render(<MessageBubble m={base()} mine={false} />)
    expect(screen.getByText('Hello there')).toBeInTheDocument()
  })

  it('renders **bold** markdown as a <strong>', () => {
    render(<MessageBubble m={base({ text: 'A **strong** word' })} mine={false} />)
    const strong = screen.getByText('strong')
    expect(strong.tagName).toBe('STRONG')
  })

  it('a system message renders centered text without a sender label', () => {
    render(<MessageBubble m={base({ sender: 'system', text: 'Chat closed', senderName: null })} mine={false} label="X" />)
    expect(screen.getByText('Chat closed')).toBeInTheDocument()
    expect(screen.queryByText('X')).toBeNull()
  })

  it('shows the sender label when provided', () => {
    render(<MessageBubble m={base()} mine={false} label="Riya" />)
    expect(screen.getByText('Riya')).toBeInTheDocument()
  })

  it('shows ticks for own messages when showTicks is set', () => {
    render(<MessageBubble m={base({ status: 'read' })} mine showTicks />)
    expect(screen.getByLabelText('Seen')).toBeInTheDocument()
  })

  it('toggles between translation and original text', () => {
    render(<MessageBubble m={base({ text: 'Hello', original: { text: 'नमस्ते', lang: 'hi' } })} mine={false} />)
    // Starts on translation; toggle shows original.
    expect(screen.getByText('Hello')).toBeInTheDocument()
    fireEvent.click(screen.getByText(/Show original/))
    expect(screen.getByText('नमस्ते')).toBeInTheDocument()
    // And back.
    fireEvent.click(screen.getByText('Show translation'))
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('a failed own message shows the error and a working Retry button', () => {
    const onRetry = vi.fn()
    const m = base({ status: 'failed', error: 'Network error' })
    render(<MessageBubble m={m} mine onRetry={onRetry} />)
    expect(screen.getByText('Network error')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Retry'))
    expect(onRetry).toHaveBeenCalledWith(m)
  })

  it('renders payload chips inside a bubble and wires onChip', () => {
    const onChip = vi.fn()
    const m = base({ text: '', payloads: [{ type: 'chips', chips: [{ label: 'Yes', text: 'yes please' }] }] })
    render(<MessageBubble m={m} mine={false} onChip={onChip} />)
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(onChip).toHaveBeenCalledWith('yes please')
  })
})
