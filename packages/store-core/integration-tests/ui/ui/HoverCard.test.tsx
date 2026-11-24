import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import HoverCard from '@/components/ui/HoverCard'

afterEach(() => vi.useRealTimers())

describe('HoverCard', () => {
  it('shows the trigger only until hovered', () => {
    render(
      <HoverCard trigger={<b>Hover me</b>}>
        <p>Card body</p>
      </HoverCard>
    )
    expect(screen.getByText('Hover me')).toBeInTheDocument()
    expect(screen.queryByText('Card body')).toBeNull()
  })

  it('reveals the card after the delay, portalled out of the trigger, and hides it after leaving', () => {
    vi.useFakeTimers()
    render(
      <HoverCard trigger={<b>Hover me</b>} delay={100}>
        <p>Card body</p>
      </HoverCard>
    )
    const trigger = screen.getByText('Hover me').parentElement as HTMLElement
    fireEvent.mouseEnter(trigger)
    act(() => void vi.advanceTimersByTime(99))
    expect(screen.queryByText('Card body')).toBeNull()
    act(() => void vi.advanceTimersByTime(2))
    const body = screen.getByText('Card body')
    expect(trigger.contains(body)).toBe(false)
    expect(document.body.contains(body)).toBe(true)

    fireEvent.mouseLeave(trigger)
    act(() => void vi.advanceTimersByTime(100))
    expect(screen.queryByText('Card body')).toBeNull()
  })

  it('stays open while the pointer is over the card itself', () => {
    vi.useFakeTimers()
    render(
      <HoverCard trigger={<b>Hover me</b>} delay={0}>
        <p>Card body</p>
      </HoverCard>
    )
    const trigger = screen.getByText('Hover me').parentElement as HTMLElement
    fireEvent.mouseEnter(trigger)
    act(() => void vi.advanceTimersByTime(1))
    const card = screen.getByText('Card body').closest('.fixed') as HTMLElement
    fireEvent.mouseLeave(trigger)
    fireEvent.mouseEnter(card)
    act(() => void vi.advanceTimersByTime(200))
    expect(screen.getByText('Card body')).toBeInTheDocument()
    fireEvent.mouseLeave(card)
    act(() => void vi.advanceTimersByTime(100))
    expect(screen.queryByText('Card body')).toBeNull()
  })

  it('does not show a card that was left before the delay elapsed', () => {
    vi.useFakeTimers()
    render(
      <HoverCard trigger={<b>Hover me</b>} delay={150}>
        <p>Card body</p>
      </HoverCard>
    )
    const trigger = screen.getByText('Hover me').parentElement as HTMLElement
    fireEvent.mouseEnter(trigger)
    fireEvent.mouseLeave(trigger)
    act(() => void vi.advanceTimersByTime(500))
    expect(screen.queryByText('Card body')).toBeNull()
  })

  it('opens upward on side="top" and uses the requested width', () => {
    vi.useFakeTimers()
    render(
      <HoverCard trigger={<b>Hover me</b>} delay={0} side="top" width="200px">
        <p>Card body</p>
      </HoverCard>
    )
    fireEvent.mouseEnter(screen.getByText('Hover me').parentElement as HTMLElement)
    act(() => void vi.advanceTimersByTime(1))
    const card = screen.getByText('Card body').closest('.fixed') as HTMLElement
    expect(card.style.width).toBe('200px')
    expect(card.style.bottom).not.toBe('')
    expect(card.style.top).toBe('')
  })
})
