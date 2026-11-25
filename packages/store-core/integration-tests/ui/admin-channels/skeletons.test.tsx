import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RangeLoading, TableSectionLoading, ChannelPanelLoading, CHANGE_COLUMNS, RUN_COLUMNS } from '@/components/admin/channels/skeletons'

describe('channel skeletons', () => {
  it('RangeLoading shows the preset labels', () => {
    render(<RangeLoading presets={[7, 30]} active={30} />)
    expect(screen.getByText('7d')).toBeInTheDocument()
    expect(screen.getByText('30d').className).toContain('bg-accent-500')
    expect(screen.getByText('7d').className).not.toContain('bg-accent-500')
  })

  it('TableSectionLoading shows the title, note and column headings', () => {
    render(<TableSectionLoading title="Orders" columns={['A', 'B']} note="Loading orders" />)
    expect(screen.getByText('Orders')).toBeInTheDocument()
    expect(screen.getByText('Loading orders')).toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('ChannelPanelLoading picks the right panel shape', () => {
    const { rerender } = render(<ChannelPanelLoading tab="alerts" />)
    expect(screen.getByText('Alerts')).toBeInTheDocument()
    rerender(<ChannelPanelLoading tab="changes" />)
    expect(screen.getByText('Change history')).toBeInTheDocument()
    for (const c of CHANGE_COLUMNS) expect(screen.getByText(c)).toBeInTheDocument()
    rerender(<ChannelPanelLoading tab="runs" />)
    expect(screen.getByText('Job runs')).toBeInTheDocument()
    for (const c of RUN_COLUMNS) expect(screen.getByText(c)).toBeInTheDocument()
  })
})
