import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

let search = ''
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search) }))

import DesktopRequiredBanner from '@/components/admin/DesktopRequiredBanner'

describe('DesktopRequiredBanner', () => {
  beforeEach(() => {
    search = ''
  })

  it('renders nothing without the desktop_required param', () => {
    const { container } = render(<DesktopRequiredBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('explains that write actions need desktop when the param is set', () => {
    search = 'desktop_required=1'
    render(<DesktopRequiredBanner />)
    expect(screen.getByText('Desktop required for editing')).toBeInTheDocument()
    expect(screen.getByText(/Write actions are only available on desktop/)).toBeInTheDocument()
  })
})
