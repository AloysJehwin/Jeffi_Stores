import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { CodeNode } from '@jeffi/site-blocks'
import SlidePanel from '@/components/site-editor/SlidePanel'
import { slideFrameClasses } from '@/lib/site/code/slide'

const lit = (v: string) => ({ k: 'lit' as const, v })
const root = (cls: string): CodeNode => ({
  t: 'el',
  tag: 'section',
  id: 'e1',
  props: { className: lit(cls) },
  children: [{ t: 'el', tag: 'h2', id: 'e2', props: { className: lit('text-3xl') }, children: [{ t: 'text', value: 'Hi', id: 'e2.0' }] }],
})
const handlers = () => ({ onAspect: vi.fn(), onFlow: vi.fn(), onMake: vi.fn() })

describe('SlidePanel', () => {
  it('offers to make a normal section a slide', () => {
    const h = handlers()
    render(<SlidePanel tree={root('py-16')} bp="lg" canWrite {...h} />)
    expect(screen.queryByRole('group', { name: 'Slide shape' })).toBeNull()
    fireEvent.click(screen.getByText('Make this a slide'))
    expect(h.onMake).toHaveBeenCalledTimes(1)
  })

  it('shows a slide’s shape, switches it, and goes back to a normal section', () => {
    const h = handlers()
    render(<SlidePanel tree={root(slideFrameClasses('16:9'))} bp="lg" canWrite {...h} />)
    expect(screen.getByText(/1 layer/)).toBeInTheDocument()
    expect(screen.getByText('Wide 16:9')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByText('Wide 16:9'))
    expect(h.onAspect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Classic 4:3'))
    expect(h.onAspect).toHaveBeenLastCalledWith('4:3')
    expect(screen.getByText(/no fixed shape/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Back to a normal section'))
    expect(h.onFlow).toHaveBeenCalledTimes(1)
  })

  it('explains phones on the phone breakpoint and is read-only without write access', () => {
    render(<SlidePanel tree={root(slideFrameClasses('16:9'))} bp="base" canWrite={false} {...handlers()} />)
    expect(screen.getByText(/stacked in reading order/)).toBeInTheDocument()
    expect(screen.getByText('Classic 4:3')).toBeDisabled()
    expect(screen.queryByText('Back to a normal section')).toBeNull()
  })
})
