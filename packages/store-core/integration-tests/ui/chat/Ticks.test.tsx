import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Ticks from '@/components/chat/Ticks'
import type { MessageStatus } from '@/lib/support/types'

// Receipt glyph: each status maps to a distinct label + icon.

describe('Ticks (status receipts)', () => {
  const cases: Array<[MessageStatus, string]> = [
    ['sending', 'Sending'],
    ['sent', 'Sent'],
    ['delivered', 'Delivered'],
    ['read', 'Seen'],
    ['failed', 'Not sent'],
  ]

  it.each(cases)('labels %s as "%s"', (status, label) => {
    render(<Ticks status={status} />)
    expect(screen.getByLabelText(label)).toBeInTheDocument()
    expect(screen.getByTitle(label)).toBeInTheDocument()
  })

  it('passes a custom className through to the icon', () => {
    const { container } = render(<Ticks status="sent" className="extra-cls" />)
    expect(container.querySelector('.extra-cls')).toBeTruthy()
  })
})
