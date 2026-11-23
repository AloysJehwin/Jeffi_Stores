import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Slides is the carousel engine; here we only verify SectionCarousel forwards its props through.
const slidesSpy = vi.fn<(...a: any[]) => any>()
vi.mock('@/components/visitor/slides/Slides', () => ({
  default: (props: any) => {
    slidesSpy(props)
    return (
      <div data-testid="slides" data-layout={props.layout} aria-label={props.ariaLabel}>
        {props.children}
      </div>
    )
  },
}))

import SectionCarousel from '@/components/visitor/SectionCarousel'

describe('SectionCarousel (render + prop forwarding)', () => {
  it('renders its children inside the rail Slides', () => {
    render(
      <SectionCarousel ariaLabel="Featured">
        <span>Item one</span>
        <span>Item two</span>
      </SectionCarousel>
    )
    const slides = screen.getByTestId('slides')
    expect(slides).toHaveAttribute('data-layout', 'rail')
    expect(slides).toHaveAttribute('aria-label', 'Featured')
    expect(screen.getByText('Item one')).toBeInTheDocument()
    expect(screen.getByText('Item two')).toBeInTheDocument()
  })

  it('passes the itemClassName through to Slides', () => {
    render(
      <SectionCarousel ariaLabel="Deals" itemClassName="w-[30%]">
        <span>x</span>
      </SectionCarousel>
    )
    expect(slidesSpy).toHaveBeenCalledWith(expect.objectContaining({ itemClassName: 'w-[30%]', layout: 'rail' }))
  })
})
