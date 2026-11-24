import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Marquee from '@/components/visitor/site/code/islands/Marquee'

describe('Marquee', () => {
  it('shows the items twice (the second copy hidden from assistive tech) for a seamless loop', () => {
    const { container } = render(
      <Marquee>
        <span>Free shipping</span>
        <span>Easy returns</span>
      </Marquee>,
    )
    expect(screen.getAllByText('Free shipping')).toHaveLength(2)
    expect(screen.getAllByText('Easy returns')).toHaveLength(2)
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('Free shippingEasy returns')
  })

  it('maps speed to the animation duration, falling back to normal', () => {
    const { container, rerender } = render(<Marquee speed="fast"><i>x</i></Marquee>)
    const track = () => container.querySelector('.cs-marquee-track') as HTMLElement
    expect(track().style.animationDuration).toBe('15s')
    rerender(<Marquee speed="slow"><i>x</i></Marquee>)
    expect(track().style.animationDuration).toBe('45s')
    rerender(<Marquee speed="bogus"><i>x</i></Marquee>)
    expect(track().style.animationDuration).toBe('28s')
  })

  it('flags direction and pause-on-hover through data attributes', () => {
    const { container, rerender } = render(<Marquee direction="right"><i>x</i></Marquee>)
    const root = () => container.firstChild as HTMLElement
    expect(root()).toHaveAttribute('data-reverse')
    expect(root()).toHaveAttribute('data-pause')
    rerender(<Marquee pauseOnHover={false}><i>x</i></Marquee>)
    expect(root()).not.toHaveAttribute('data-reverse')
    expect(root()).not.toHaveAttribute('data-pause')
  })

  it('includes the animation styles and respects reduced motion', () => {
    const { container } = render(<Marquee><i>x</i></Marquee>)
    const css = container.querySelector('style')!.innerHTML
    expect(css).toContain('@keyframes cs-marquee')
    expect(css).toContain('prefers-reduced-motion')
  })

  it('renders nothing without children', () => {
    const { container } = render(<Marquee />)
    expect(container).toBeEmptyDOMElement()
  })
})
