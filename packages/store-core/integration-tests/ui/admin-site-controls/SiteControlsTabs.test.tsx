import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// SiteControlsTabs: a URL-driven tab switcher. next/navigation is mocked so we can watch router.replace
// and control the active tab via the ?tab search param. Inactive panels stay mounted but hidden.

const replace = vi.fn<(...a: any[]) => any>()
let currentTab: string | null = null
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/site-controls',
  useSearchParams: () => new URLSearchParams(currentTab ? `tab=${currentTab}` : ''),
}))

import SiteControlsTabs from '@/components/admin/site-controls/SiteControlsTabs'

const tabs = [
  { id: 'general', label: 'General', content: <p>general body</p> },
  { id: 'email', label: 'Email', content: <p>email body</p> },
]

describe('SiteControlsTabs', () => {
  // happy-dom doesn't apply Tailwind's `hidden` class, so we assert the class marker
  // (active panels drop `hidden`) rather than computed visibility.
  const panelOf = (text: string) => screen.getByText(text).closest('[role="tabpanel"]')!

  it('defaults to the first tab when no ?tab is set and mounts all panels', () => {
    currentTab = null
    render(<SiteControlsTabs tabs={tabs} />)
    const panels = screen.getAllByRole('tabpanel', { hidden: true })
    expect(panels).toHaveLength(2)
    expect(panelOf('general body')).not.toHaveClass('hidden')
    expect(panelOf('email body')).toHaveClass('hidden')
  })

  it('honours a valid ?tab param', () => {
    currentTab = 'email'
    render(<SiteControlsTabs tabs={tabs} />)
    expect(panelOf('email body')).not.toHaveClass('hidden')
    expect(panelOf('general body')).toHaveClass('hidden')
  })

  it('falls back to the first tab for an unknown ?tab value', () => {
    currentTab = 'nope'
    render(<SiteControlsTabs tabs={tabs} />)
    expect(panelOf('general body')).not.toHaveClass('hidden')
  })

  it('calls router.replace with the chosen tab when a tab is clicked', () => {
    currentTab = 'general'
    replace.mockReset()
    render(<SiteControlsTabs tabs={tabs} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Email' }))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).toContain('tab=email')
    expect(replace.mock.calls[0][1]).toEqual({ scroll: false })
  })
})
