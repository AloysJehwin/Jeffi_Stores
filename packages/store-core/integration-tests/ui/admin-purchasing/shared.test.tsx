import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SummaryCard, formatINR, fmtINR2, STATUS_BADGE, TYPE_BADGE, PAGE_SIZE } from '@/components/admin/purchasing/shared'

describe('purchasing shared', () => {
  it('SummaryCard shows label, value and sub text', () => {
    render(<SummaryCard label="Open POs" value="12" sub="3 overdue" />)
    expect(screen.getByText('Open POs')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('3 overdue')).toBeInTheDocument()
  })

  it('formats money', () => {
    expect(formatINR(1234)).toContain('1,234')
    expect(fmtINR2(1234.5)).toBe('1,234.50')
  })

  it('has a badge class per status and movement type', () => {
    expect(Object.keys(STATUS_BADGE)).toEqual(['draft', 'sent', 'partial', 'received', 'cancelled'])
    expect(Object.keys(TYPE_BADGE)).toEqual(['purchase', 'sale', 'return', 'adjustment'])
    expect(PAGE_SIZE).toBe(20)
  })
})
