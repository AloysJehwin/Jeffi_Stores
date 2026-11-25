import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const toggleAgent = vi.fn()
let ctx = { enabled: true, open: false, onAgentPage: false, toggleAgent }
vi.mock('@/contexts/AdminAgentContext', () => ({ useAdminAgent: () => ctx }))

import AdminAgentTrigger from '@/components/admin/AdminAgentTrigger'

describe('AdminAgentTrigger', () => {
  beforeEach(() => {
    ctx = { enabled: true, open: false, onAgentPage: false, toggleAgent }
  })

  it('renders a toggle button and calls toggleAgent on click', () => {
    render(<AdminAgentTrigger />)
    const btn = screen.getByRole('button', { name: 'Toggle admin assistant' })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(btn)
    expect(toggleAgent).toHaveBeenCalledTimes(1)
  })

  it('reflects the open state', () => {
    ctx.open = true
    render(<AdminAgentTrigger />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders nothing when the agent is disabled', () => {
    ctx.enabled = false
    const { container } = render(<AdminAgentTrigger />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing on the agent page itself', () => {
    ctx.onAgentPage = true
    const { container } = render(<AdminAgentTrigger />)
    expect(container.firstChild).toBeNull()
  })
})
