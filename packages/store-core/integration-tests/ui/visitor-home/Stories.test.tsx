import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/visitor/StoreImage', () => ({ default: ({ src }: any) => <img src={src} alt="" /> }))
vi.mock('@/components/visitor/slides/SlideControls', () => ({
  SlideArrows: ({ onPrev, onNext }: any) => (
    <div>
      <button onClick={onPrev}>Scroll stories left</button>
      <button onClick={onNext}>Scroll stories right</button>
    </div>
  ),
}))
vi.mock('@/components/visitor/home/StoryViewer', () => ({
  default: ({ groups, startIndex, onClose, onGroupOpen }: any) => (
    <div role="dialog" aria-label="viewer">
      <span data-testid="viewing">{groups[startIndex].title}</span>
      <button onClick={() => onGroupOpen(groups[startIndex])}>mark seen</button>
      <button onClick={onClose}>close viewer</button>
    </div>
  ),
}))

import Stories, { STORIES_SEEN_KEY } from '@/components/visitor/home/Stories'

const groups = [
  { id: 'g1', title: 'New in', cover: '/c1.jpg', slides: [{ id: 'a', image: '/a.jpg' }, { id: 'b', image: '/b.jpg' }] },
  { id: 'g2', title: 'Sale', cover: '/c2.jpg', slides: [{ id: 'c', image: '/c.jpg' }] },
] as any

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  )
})

describe('Stories', () => {
  it('renders nothing without groups', () => {
    const { container } = render(<Stories groups={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists a ring per group with story counts and default copy', () => {
    render(<Stories groups={groups} />)
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New in, 2 stories' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sale, 1 story' })).toBeInTheDocument()
  })

  it('uses a custom eyebrow and title', () => {
    render(<Stories groups={groups} eyebrow="Follow" title="Our stories" />)
    expect(screen.getByText('Follow')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Our stories' })).toBeInTheDocument()
  })

  it('opens the viewer on the tapped group and closes it again', () => {
    render(<Stories groups={groups} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sale, 1 story' }))
    expect(screen.getByTestId('viewing')).toHaveTextContent('Sale')
    fireEvent.click(screen.getByText('close viewer'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('remembers a seen group in localStorage and labels it seen', () => {
    render(<Stories groups={groups} />)
    fireEvent.click(screen.getByRole('button', { name: 'New in, 2 stories' }))
    fireEvent.click(screen.getByText('mark seen'))
    expect(JSON.parse(window.localStorage.getItem(STORIES_SEEN_KEY)!)).toEqual({ g1: 2 })
    expect(screen.getByRole('button', { name: 'New in, 2 stories, seen' })).toBeInTheDocument()
  })

  it('restores seen state from storage and ignores malformed storage', () => {
    window.localStorage.setItem(STORIES_SEEN_KEY, JSON.stringify({ g2: 1, g1: 1, bad: 'x' }))
    const { unmount } = render(<Stories groups={groups} />)
    expect(screen.getByRole('button', { name: 'Sale, 1 story, seen' })).toBeInTheDocument()
    // g1 has 2 slides now, so a count of 1 means new slides: unseen again.
    expect(screen.getByRole('button', { name: 'New in, 2 stories' })).toBeInTheDocument()
    unmount()
    window.localStorage.setItem(STORIES_SEEN_KEY, '{not json')
    render(<Stories groups={groups} />)
    expect(screen.getByRole('button', { name: 'Sale, 1 story' })).toBeInTheDocument()
  })
})
