'use client'

import Slides from '@/components/visitor/slides/Slides'

interface SectionCarouselProps {
  children: React.ReactNode
  /** Width of each item at each breakpoint, e.g. "w-[45%] sm:w-[30%] lg:w-[18%]". */
  itemClassName?: string
  ariaLabel: string
}

// CSS scroll-snap does the scrolling: native momentum, touch and keyboard for free, and the
// content is fully server-rendered. JS only drives the arrow buttons and their disabled state.
export default function SectionCarousel({ children, itemClassName, ariaLabel }: SectionCarouselProps) {
  return (
    <Slides layout="rail" ariaLabel={ariaLabel} itemClassName={itemClassName}>
      {children}
    </Slides>
  )
}
