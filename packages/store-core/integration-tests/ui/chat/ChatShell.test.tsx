import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ChatShell from '@/components/chat/ChatShell'

describe('ChatShell (layout slots)', () => {
  it('renders children only when no optional slots are given', () => {
    render(<ChatShell>body-content</ChatShell>)
    expect(screen.getByText('body-content')).toBeInTheDocument()
    expect(screen.queryByText('the-header')).toBeNull()
  })

  it('renders header, banner, children and composer when all are supplied', () => {
    render(
      <ChatShell header={<div>the-header</div>} banner={<div>the-banner</div>} composer={<div>the-composer</div>}>
        <div>the-body</div>
      </ChatShell>
    )
    expect(screen.getByText('the-header')).toBeInTheDocument()
    expect(screen.getByText('the-banner')).toBeInTheDocument()
    expect(screen.getByText('the-body')).toBeInTheDocument()
    expect(screen.getByText('the-composer')).toBeInTheDocument()
  })

  it('applies an extra className to the root', () => {
    const { container } = render(<ChatShell className="my-shell">x</ChatShell>)
    expect(container.querySelector('.my-shell')).toBeTruthy()
  })
})
