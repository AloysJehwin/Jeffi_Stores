import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const swipeOpts = vi.hoisted(() => ({ current: null as any }))
const autoplayOpts = vi.hoisted(() => ({ current: null as any }))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/components/visitor/StoreImage', () => ({ default: ({ src }: any) => <img data-testid="cover" src={src} alt="" /> }))
vi.mock('@/components/visitor/media/StoreMedia', () => ({
  default: ({ image, video, alt }: any) => <div data-testid="media" data-image={image} data-video={video ?? ''} data-alt={alt} />,
  canPlayVideo: () => false,
}))
vi.mock('@/components/visitor/slides/SlideControls', () => ({
  SlideProgress: ({ count, index }: any) => <div data-testid="progress" data-count={count} data-index={index} />,
}))
vi.mock('@/components/visitor/slides/useAutoplay', () => ({
  useAutoplay: (o: any) => {
    autoplayOpts.current = o
    return { progress: { set: vi.fn() } }
  },
}))
vi.mock('@/components/visitor/slides/useSwipe', () => ({
  useSwipe: (o: any) => {
    swipeOpts.current = o
    return { pressed: false, bind: {} }
  },
}))

import StoryViewer from '@/components/visitor/home/StoryViewer'

const groups = [
  {
    id: 'g1',
    title: 'New in',
    cover: '/c1.jpg',
    slides: [
      { id: 's1', image: '/a.jpg', caption: 'Fresh drop', url: '/new', ctaLabel: 'See it', seconds: 5 },
      { id: 's2', image: '/b.jpg', seconds: 3 },
    ],
  },
  { id: 'g2', title: 'Sale', cover: '/c2.jpg', slides: [{ id: 's3', image: '/c.jpg', url: '/sale', seconds: 4 }] },
] as any

const setup = (startIndex = 0) => {
  const onClose = vi.fn()
  const onGroupOpen = vi.fn()
  render(<StoryViewer groups={groups} startIndex={startIndex} onClose={onClose} onGroupOpen={onGroupOpen} />)
  return { onClose, onGroupOpen }
}

beforeEach(() => {
  document.body.style.overflow = ''
})

describe('StoryViewer', () => {
  it('opens a modal on the group with its first slide, caption and CTA, and reports the group open', () => {
    const { onGroupOpen } = setup()
    expect(screen.getByRole('dialog', { name: 'New in stories' })).toBeInTheDocument()
    expect(screen.getByTestId('media')).toHaveAttribute('data-image', '/a.jpg')
    expect(screen.getByText('Fresh drop')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /See it/ })).toHaveAttribute('href', '/new')
    expect(screen.getByTestId('progress')).toHaveAttribute('data-count', '2')
    expect(screen.getByText('New in, 1 of 2')).toBeInTheDocument()
    expect(onGroupOpen).toHaveBeenCalledWith(groups[0])
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('moves through slides, then into the next group, then closes at the very end', () => {
    const { onClose, onGroupOpen } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Next story' }))
    expect(screen.getByTestId('media')).toHaveAttribute('data-image', '/b.jpg')
    fireEvent.click(screen.getByRole('button', { name: 'Next story' }))
    expect(screen.getByRole('dialog', { name: 'Sale stories' })).toBeInTheDocument()
    expect(onGroupOpen).toHaveBeenLastCalledWith(groups[1])
    expect(screen.getByRole('link', { name: /Shop now/ })).toHaveAttribute('href', '/sale')
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Next story' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('goes back a slide and across groups', () => {
    setup(1)
    fireEvent.click(screen.getByRole('button', { name: 'Previous story' }))
    expect(screen.getByRole('dialog', { name: 'New in stories' })).toBeInTheDocument()
    expect(screen.getByTestId('media')).toHaveAttribute('data-image', '/a.jpg')
  })

  it('restarts the first slide when going back from the very start', () => {
    setup()
    const before = autoplayOpts.current.resetKey
    fireEvent.click(screen.getByRole('button', { name: 'Previous story' }))
    expect(autoplayOpts.current.resetKey).not.toBe(before)
    expect(screen.getByTestId('media')).toHaveAttribute('data-image', '/a.jpg')
  })

  it('advances when the slide timer completes', () => {
    setup()
    act(() => autoplayOpts.current.onComplete())
    expect(screen.getByTestId('media')).toHaveAttribute('data-image', '/b.jpg')
  })

  it('handles keyboard: arrows navigate and Escape closes', () => {
    const { onClose } = setup()
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(screen.getByTestId('media')).toHaveAttribute('data-image', '/b.jpg')
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(screen.getByTestId('media')).toHaveAttribute('data-image', '/a.jpg')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('treats a tap on the left third as back and elsewhere as forward, and swipes navigate', () => {
    setup()
    const rect = { left: 0, width: 300 }
    const tap = (clientX: number) => act(() => swipeOpts.current.onTap({ clientX, currentTarget: { getBoundingClientRect: () => rect } }))
    tap(250)
    expect(screen.getByTestId('media')).toHaveAttribute('data-image', '/b.jpg')
    tap(10)
    expect(screen.getByTestId('media')).toHaveAttribute('data-image', '/a.jpg')
    act(() => swipeOpts.current.onSwipe(1))
    expect(screen.getByTestId('media')).toHaveAttribute('data-image', '/b.jpg')
    act(() => swipeOpts.current.onSwipe(-1))
    expect(screen.getByTestId('media')).toHaveAttribute('data-image', '/a.jpg')
  })

  it('closes from the close button and on a drag down, and restores body scroll on unmount', () => {
    const onClose = vi.fn()
    const { unmount } = render(<StoryViewer groups={groups} startIndex={0} onClose={onClose} onGroupOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close stories' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => swipeOpts.current.onDragDown())
    expect(onClose).toHaveBeenCalledTimes(2)
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('renders nothing for an out-of-range group', () => {
    render(<StoryViewer groups={groups} startIndex={9} onClose={vi.fn()} onGroupOpen={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
