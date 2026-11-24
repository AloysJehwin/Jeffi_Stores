import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DateTimePicker from '@/components/ui/DateTimePicker'

const open = () => fireEvent.click(screen.getAllByRole('button')[0])
const day = (n: number) => screen.getByRole('button', { name: String(n), exact: true })

describe('DateTimePicker', () => {
  it('shows the placeholder, or the formatted value, and a hidden form field when named', () => {
    const { container, rerender } = render(<DateTimePicker value="" onChange={() => {}} name="when" placeholder="Pick one" />)
    expect(screen.getByText('Pick one')).toBeInTheDocument()
    expect((container.querySelector('input[name="when"]') as HTMLInputElement).value).toBe('')
    rerender(<DateTimePicker value="2026-03-05T14:30" onChange={() => {}} name="when" />)
    expect(screen.getByText('05 Mar 2026, 14:30')).toBeInTheDocument()
    expect((container.querySelector('input[name="when"]') as HTMLInputElement).value).toBe('2026-03-05T14:30')
  })

  it('does not open when disabled', () => {
    render(<DateTimePicker value="" onChange={() => {}} disabled />)
    open()
    expect(document.querySelector('[data-datepicker-popup]')).toBeNull()
  })

  it('picks a day, then a time, and reports the combined value', () => {
    const onChange = vi.fn()
    render(<DateTimePicker value="2026-03-05T14:30" onChange={onChange} />)
    open()
    expect(screen.getByRole('button', { name: 'March 2026' })).toBeInTheDocument()
    fireEvent.click(day(18))
    expect(screen.getByText('18 Mar 2026')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '09' }))
    fireEvent.click(screen.getByRole('button', { name: ':45' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onChange).toHaveBeenCalledWith('2026-03-18T09:45')
    expect(document.querySelector('[data-datepicker-popup]')).toBeNull()
  })

  it('goes back from the time step to the days', () => {
    render(<DateTimePicker value="2026-03-05T14:30" onChange={() => {}} />)
    open()
    fireEvent.click(day(7))
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(screen.getByRole('button', { name: 'March 2026' })).toBeInTheDocument()
  })

  it('moves between months, rolling the year over', () => {
    render(<DateTimePicker value="2026-01-15T00:00" onChange={() => {}} />)
    open()
    const [prev, , next] = Array.from(document.querySelectorAll('[data-datepicker-popup] > div:first-child button')) as HTMLElement[]
    fireEvent.click(prev)
    expect(screen.getByRole('button', { name: 'December 2025' })).toBeInTheDocument()
    fireEvent.click(next)
    fireEvent.click(next)
    expect(screen.getByRole('button', { name: 'February 2026' })).toBeInTheDocument()
  })

  it('jumps through the month and year grids', () => {
    render(<DateTimePicker value="2026-03-05T14:30" onChange={() => {}} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'March 2026' }))
    fireEvent.click(screen.getByRole('button', { name: '2026' }))
    expect(screen.getByText('2016–2027')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '2024' }))
    fireEvent.click(screen.getByRole('button', { name: 'Nov' }))
    expect(screen.getByRole('button', { name: 'November 2024' })).toBeInTheDocument()
  })

  it('disables days outside min and max', () => {
    render(<DateTimePicker value="2026-03-15T00:00" onChange={() => {}} min="2026-03-10T00:00" max="2026-03-20" />)
    open()
    expect(day(9)).toBeDisabled()
    expect(day(10)).toBeEnabled()
    expect(day(20)).toBeEnabled()
    expect(day(21)).toBeDisabled()
  })

  it('clears the value', () => {
    const onChange = vi.fn()
    render(<DateTimePicker value="2026-03-05T14:30" onChange={onChange} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onChange).toHaveBeenCalledWith('')
    expect(document.querySelector('[data-datepicker-popup]')).toBeNull()
  })

  it('has no Clear without a value, and closes on an outside click', () => {
    render(<DateTimePicker value="" onChange={() => {}} />)
    open()
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
    expect(document.querySelector('[data-datepicker-popup]')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(document.querySelector('[data-datepicker-popup]')).toBeNull()
  })

  it('treats a malformed value as empty', () => {
    render(<DateTimePicker value="garbage" onChange={() => {}} placeholder="Pick one" />)
    expect(screen.getByText('Pick one')).toBeInTheDocument()
  })
})
