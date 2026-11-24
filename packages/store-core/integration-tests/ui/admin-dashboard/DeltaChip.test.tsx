import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DeltaChip } from '@/components/admin/dashboard/DeltaChip'

describe('DeltaChip', () => {
  it('shows an up arrow in green for a positive change', () => {
    render(<DeltaChip value={6.14} />)
    const chip = screen.getByRole('status')
    expect(chip).toHaveTextContent('↑ 6.1%')
    expect(chip).toHaveAttribute('data-tone', 'good')
    expect(chip.className).toContain('green')
    expect(chip).toHaveAttribute('aria-label', 'Up 6.1 percent')
  })

  it('shows a down arrow in red for a negative change', () => {
    render(<DeltaChip value={-3} />)
    const chip = screen.getByRole('status')
    expect(chip).toHaveTextContent('↓ 3.0%')
    expect(chip).toHaveAttribute('data-tone', 'bad')
    expect(chip.className).toContain('red')
  })

  it('flips the colour when lower is better', () => {
    const { rerender } = render(<DeltaChip value={-4} invert />)
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'good')
    rerender(<DeltaChip value={4} invert />)
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'bad')
  })

  it('is neutral for zero and for unknown values', () => {
    const { rerender } = render(<DeltaChip value={0} />)
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'neutral')
    expect(screen.getByRole('status')).toHaveTextContent('0.0%')
    rerender(<DeltaChip value={null} />)
    expect(screen.getByRole('status')).toHaveTextContent('–')
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'No change data')
  })
})
