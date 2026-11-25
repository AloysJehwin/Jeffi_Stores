import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AutosaveStatusPill from '@/components/admin/AutosaveStatusPill'

describe('AutosaveStatusPill', () => {
  it.each([
    ['saved', 'Draft saved', /emerald/],
    ['error', 'Save failed', /rose/],
    ['locked', 'Read-only', /amber/],
    ['idle', 'Draft', /surface-secondary/],
  ] as const)('shows the %s label and tone', (status, label, tone) => {
    render(<AutosaveStatusPill status={status as any} />)
    const pill = screen.getByText(label)
    expect(pill.className).toMatch(tone)
  })

  it('shows a pulsing dot only while saving', () => {
    const { container, rerender } = render(<AutosaveStatusPill status="saving" />)
    expect(screen.getByText('Saving…')).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    rerender(<AutosaveStatusPill status="saved" />)
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })
})
