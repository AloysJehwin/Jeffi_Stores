import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Replace the portal-based select with a native one so the view switch is driveable.
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange }: any) => (
    <select aria-label="view" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))

import { fireEvent } from '@testing-library/react'
import CustomerEngagementChart from '@/components/admin/CustomerEngagementChart'

const segments = [
  { label: 'Active', value: 30, color: '#0f0' },
  { label: 'Dormant', value: 10, color: '#f00' },
  { label: 'Zero', value: 0, color: '#000' },
]
const channelMix = [{ label: 'Email', value: 5, color: '#00f' }]

describe('CustomerEngagementChart', () => {
  it('shows the engagement segments with counts and share, hiding zero rows', () => {
    render(<CustomerEngagementChart segments={segments} channelMix={channelMix} />)
    expect(screen.getByText('Customer Engagement')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('(75%)')).toBeInTheDocument()
    expect(screen.getByText('(25%)')).toBeInTheDocument()
    expect(screen.queryByText('Zero')).toBeNull()
  })

  it('switches to the channel dataset', () => {
    render(<CustomerEngagementChart segments={segments} channelMix={channelMix} />)
    fireEvent.change(screen.getByLabelText('view'), { target: { value: 'channel' } })
    expect(screen.getByText('Email')).toBeInTheDocument()
    expect(screen.getByText('(100%)')).toBeInTheDocument()
    expect(screen.queryByText('Active')).toBeNull()
  })

  it('shows the empty state when there is no data', () => {
    render(<CustomerEngagementChart segments={[]} channelMix={[]} />)
    expect(screen.getByText('No data')).toBeInTheDocument()
  })
})
