import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

let chrome: any
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ chrome }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))

import AnnouncementBar from '@/components/visitor/AnnouncementBar'

describe('AnnouncementBar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    chrome = undefined
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing when no announcements are set', () => {
    const { container } = render(<AnnouncementBar />)
    expect(container).toBeEmptyDOMElement()
    chrome = { announcements: [] }
    const again = render(<AnnouncementBar />)
    expect(again.container).toBeEmptyDOMElement()
  })

  it('shows a plain message in a labelled region', () => {
    chrome = { announcements: [{ text: 'Free shipping over 999', tone: 'brand' }] }
    render(<AnnouncementBar />)
    const region = screen.getByRole('region', { name: 'Announcement' })
    expect(region).toHaveTextContent('Free shipping over 999')
    expect(region.className).toContain('bg-primary-500')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('links the message when an href is set and falls back to the dark tone', () => {
    chrome = { announcements: [{ text: 'Diwali sale', href: '/offers', tone: 'bogus' }] }
    render(<AnnouncementBar />)
    expect(screen.getByRole('link', { name: 'Diwali sale' })).toHaveAttribute('href', '/offers')
    expect(screen.getByRole('region').className).toContain('bg-secondary-800')
  })

  it('rotates through several messages every 5s and wraps', () => {
    chrome = { announcements: [{ text: 'One', tone: 'dark' }, { text: 'Two', tone: 'accent' }] }
    render(<AnnouncementBar />)
    expect(screen.getByText('One')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText('Two')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText('One')).toBeInTheDocument()
  })

  it('does not rotate a single message', () => {
    chrome = { announcements: [{ text: 'Only', tone: 'dark' }] }
    render(<AnnouncementBar />)
    act(() => {
      vi.advanceTimersByTime(20000)
    })
    expect(screen.getByText('Only')).toBeInTheDocument()
  })
})
