import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TypingIndicator from '@/components/chat/TypingIndicator'

describe('TypingIndicator', () => {
  it('renders the animated dots container (polite live region) without a label', () => {
    const { container } = render(<TypingIndicator />)
    const live = container.querySelector('[aria-live="polite"]')
    expect(live).toBeTruthy()
    // three bouncing dots
    expect(container.querySelectorAll('.animate-bounce').length).toBe(3)
  })

  it('shows the label when provided', () => {
    render(<TypingIndicator label="Riya is typing" />)
    expect(screen.getByText('Riya is typing')).toBeInTheDocument()
  })
})
