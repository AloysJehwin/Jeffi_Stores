import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DurationField from '@/components/admin/campaigns/DurationField'
import { days, hours } from '@/lib/campaigns/duration'

// The duration override field: a number input + unit dropdown. The value it emits is always canonical
// MINUTES, regardless of the unit shown. These tests prove the UI converts correctly so a "7 days" entry
// never silently becomes "7 minutes" in the stored params.

describe('DurationField (render + conversion)', () => {
  it('renders the recommended unit and the default placeholder in that unit', () => {
    render(
      <DurationField
        canonicalMinutes={undefined}
        defaultMinutes={days(7)}
        recommendedUnit="days"
        min={hours(1)}
        max={days(30)}
        onChange={() => {}}
      />
    )
    expect(screen.getByText(/Recommended: days/)).toBeInTheDocument()
    // Default rendered in the recommended unit (7 days), not raw minutes.
    expect(screen.getByPlaceholderText('Default: 7 days')).toBeInTheDocument()
  })

  it('emits canonical minutes for a value typed in the recommended unit (days)', () => {
    const onChange = vi.fn()
    render(
      <DurationField
        canonicalMinutes={undefined}
        defaultMinutes={days(7)}
        recommendedUnit="days"
        onChange={onChange}
      />
    )
    const input = screen.getByPlaceholderText(/Default:/) as HTMLInputElement
    fireEvent.change(input, { target: { value: '3' } })
    // 3 days -> 4320 minutes, NOT 3.
    expect(onChange).toHaveBeenLastCalledWith(days(3))
  })

  it('shows an overridden canonical-minutes value back in a clean unit', () => {
    render(
      <DurationField
        canonicalMinutes={days(2)}
        defaultMinutes={days(7)}
        recommendedUnit="days"
        onChange={() => {}}
      />
    )
    // 2 days stored as 2880 minutes should display as "2" in the days unit.
    expect(screen.getByDisplayValue('2')).toBeInTheDocument()
  })

  it('clears the override (undefined) when the input is emptied', () => {
    const onChange = vi.fn()
    render(
      <DurationField canonicalMinutes={days(2)} defaultMinutes={days(7)} recommendedUnit="days" onChange={onChange} />
    )
    const input = screen.getByDisplayValue('2') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })
})
