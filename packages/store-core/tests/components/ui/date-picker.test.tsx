import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DatePicker from '@/components/ui/DatePicker'

const open = async () => { fireEvent.click(screen.getByRole('button', { expanded: false })); return screen.findByText('Clear') }

describe('DatePicker', () => {
  it('marks the chosen day and picks another', async () => {
    const onChange = vi.fn()
    render(<DatePicker value="2026-10-15" onChange={onChange} clearable />)
    await open()
    expect(screen.getByRole('button', { name: '15', pressed: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '20' }))
    expect(onChange).toHaveBeenCalledWith('2026-10-20')
  })
  it('clears the value', async () => {
    const onChange = vi.fn()
    render(<DatePicker value="2026-10-15" onChange={onChange} clearable />)
    fireEvent.click(await open())
    expect(onChange).toHaveBeenCalledWith('')
  })
  it('respects min', async () => {
    const onChange = vi.fn()
    render(<DatePicker value="2026-10-15" onChange={onChange} min="2026-10-10" clearable />)
    await open()
    expect((screen.getByRole('button', { name: '5' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
