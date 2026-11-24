import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { createRef } from 'react'

vi.mock('@/components/visitor/StoreImage', () => ({ default: ({ src, alt, className }: any) => <img src={src} alt={alt} className={className} /> }))

import StoreMedia, { canPlayVideo, useCanPlayVideo } from '@/components/visitor/media/StoreMedia'

let matches = false
let mqListeners: Array<() => void> = []
let io: { cb: (e: any) => void } | null = null
const play = vi.fn()
const pause = vi.fn()

beforeEach(() => {
  matches = false
  mqListeners = []
  io = null
  play.mockReset()
  play.mockResolvedValue(undefined)
  pause.mockReset()
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: pause })
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return matches
    },
    addEventListener: (_: string, fn: () => void) => mqListeners.push(fn),
    removeEventListener: () => {},
  }))
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: (e: any) => void) {
        io = { cb }
      }
      observe() {}
      disconnect() {}
    }
  )
  Object.defineProperty(navigator, 'connection', { configurable: true, value: undefined })
})
afterEach(() => vi.unstubAllGlobals())

const see = (isIntersecting: boolean) => act(() => io!.cb([{ isIntersecting }]))
const video = (c: HTMLElement) => c.querySelector('video') as HTMLVideoElement

describe('canPlayVideo', () => {
  it('is true by default', () => {
    expect(canPlayVideo()).toBe(true)
  })
  it('is false for reduced motion and for Save-Data', () => {
    matches = true
    expect(canPlayVideo()).toBe(false)
    matches = false
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } })
    expect(canPlayVideo()).toBe(false)
  })
})

describe('StoreMedia', () => {
  it('draws the picture alone without a clip', () => {
    render(<StoreMedia image="/a.jpg" alt="Hero" className="cover" />)
    expect(screen.getByAltText('Hero')).toHaveAttribute('src', '/a.jpg')
  })

  it('renders nothing for no image, clip or children', () => {
    const { container } = render(<StoreMedia />)
    expect(container).toBeEmptyDOMElement()
  })

  it('children replace the default picture', () => {
    render(<StoreMedia image="/a.jpg" alt="Hero"><i data-testid="own" /></StoreMedia>)
    expect(screen.getByTestId('own')).toBeInTheDocument()
    expect(screen.queryByAltText('Hero')).not.toBeInTheDocument()
  })

  it('a clip is drawn over the picture, muted, looping and decorative when the picture carries the name', () => {
    const { container } = render(<StoreMedia image="/a.jpg" video="/v.mp4" alt="Hero" className="cover" />)
    const v = video(container)
    expect(v).toHaveAttribute('src', '/v.mp4')
    expect(v.muted).toBe(true)
    expect(v.loop).toBe(true)
    expect(v).toHaveAttribute('aria-hidden', 'true')
    expect(v.className).toContain('pointer-events-none')
    expect(v).toHaveAttribute('preload', 'none')
  })

  it('a clip with no picture takes the alt as its own label', () => {
    const { container } = render(<StoreMedia video="/v.mp4" alt="Factory tour" />)
    expect(video(container)).toHaveAttribute('aria-label', 'Factory tour')
    expect(video(container)).not.toHaveAttribute('aria-hidden')
  })

  it('a GIF is a plain image, not a video', () => {
    const { container } = render(<StoreMedia image="/a.jpg" video="/loop.gif?x=1" />)
    expect(video(container)).toBeNull()
    expect(container.querySelector('img[src="/loop.gif?x=1"]')).not.toBeNull()
  })

  it('reduced motion gets the picture only', () => {
    matches = true
    const { container } = render(<StoreMedia image="/a.jpg" video="/v.mp4" alt="Hero" />)
    expect(video(container)).toBeNull()
    expect(screen.getByAltText('Hero')).toBeInTheDocument()
  })

  it('plays only while on screen and active, pausing otherwise', () => {
    const { container, rerender } = render(<StoreMedia image="/a.jpg" video="/v.mp4" active />)
    expect(play).not.toHaveBeenCalled()
    see(true)
    expect(play).toHaveBeenCalledTimes(1)
    see(false)
    expect(pause).toHaveBeenCalled()
    see(true)
    play.mockClear()
    rerender(<StoreMedia image="/a.jpg" video="/v.mp4" active={false} />)
    expect(play).not.toHaveBeenCalled()
    expect(video(container)).toBeTruthy()
  })

  it('without IntersectionObserver the clip plays straight away', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    render(<StoreMedia image="/a.jpg" video="/v.mp4" />)
    expect(play).toHaveBeenCalled()
  })

  it('refused autoplay calls onFail, but an AbortError does not', async () => {
    const onFail = vi.fn()
    play.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AbortError' }))
    render(<StoreMedia image="/a.jpg" video="/v.mp4" onFail={onFail} />)
    see(true)
    await act(async () => {})
    expect(play).toHaveBeenCalledTimes(1)
    expect(onFail).not.toHaveBeenCalled()
    play.mockRejectedValueOnce(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }))
    see(false)
    see(true)
    await act(async () => {})
    expect(onFail).toHaveBeenCalledTimes(1)
  })

  it('reports metadata, end and error events, and hands out the video element', () => {
    const onLoadedMetadata = vi.fn()
    const onEnded = vi.fn()
    const onFail = vi.fn()
    const ref = createRef<HTMLVideoElement | null>() as { current: HTMLVideoElement | null }
    const { container } = render(<StoreMedia image="/a.jpg" video="/v.mp4" loop={false} onLoadedMetadata={onLoadedMetadata} onEnded={onEnded} onFail={onFail} videoRef={ref} />)
    const v = video(container)
    expect(ref.current).toBe(v)
    expect(v.loop).toBe(false)
    act(() => {
      v.dispatchEvent(new Event('loadedmetadata'))
      v.dispatchEvent(new Event('ended'))
      v.dispatchEvent(new Event('error'))
    })
    expect(onLoadedMetadata).toHaveBeenCalledWith(v)
    expect(onEnded).toHaveBeenCalled()
    expect(onFail).toHaveBeenCalled()
  })
})

describe('useCanPlayVideo', () => {
  function Probe() {
    return <span data-testid="p">{String(useCanPlayVideo())}</span>
  }
  it('turns true after mount and follows the reduced-motion preference', () => {
    render(<Probe />)
    expect(screen.getByTestId('p')).toHaveTextContent('true')
    matches = true
    act(() => mqListeners.forEach(f => f()))
    expect(screen.getByTestId('p')).toHaveTextContent('false')
  })
})
