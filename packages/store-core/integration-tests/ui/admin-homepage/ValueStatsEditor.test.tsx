import { describe, it, expect } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import ValueStatsEditor from '@/components/admin/homepage/editors/ValueStatsEditor'
import { renderEditor, input, commit } from './editor-kit'

// ValueStatsEditor: tick which live numbers to show and relabel each. Saves `config.metrics` in the
// canonical metric order whatever order they were ticked in.
describe('ValueStatsEditor', () => {
  it('ticks the three default metrics and shows a label field only for ticked ones', () => {
    renderEditor(ValueStatsEditor, 'value_stats')
    expect(screen.getByRole('checkbox', { name: 'Orders shipped' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Products to choose from' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Cities served' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Happy customers' })).not.toBeChecked()
    expect(screen.getAllByText('Label')).toHaveLength(3)
    expect(input('Label', 0)).toHaveValue('Orders shipped')
    expect(screen.getByText(/rounded down, e.g. 1,234 shows as 1,200\+/)).toBeInTheDocument()
  })

  it('adds a metric in canonical order with its default label', () => {
    const { onSave } = renderEditor(ValueStatsEditor, 'value_stats')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Happy customers' }))
    expect(onSave).toHaveBeenCalledWith('sec-1', {
      config: {
        metrics: [
          { metric: 'orders_shipped', label: 'Orders shipped' },
          { metric: 'products', label: 'Products to choose from' },
          { metric: 'cities', label: 'Cities served' },
          { metric: 'customers', label: 'Happy customers' },
        ],
      },
    })
  })

  it('removes a metric', () => {
    const { onSave } = renderEditor(ValueStatsEditor, 'value_stats')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cities served' }))
    const metrics = onSave.mock.calls[0][1].config.metrics
    expect(metrics.map((m: any) => m.metric)).toEqual(['orders_shipped', 'products'])
  })

  it('saves a relabelled metric, and falls back to the default label when cleared', () => {
    const { onSave } = renderEditor(ValueStatsEditor, 'value_stats', {
      config: { metrics: [{ metric: 'customers', label: 'Fans' }] },
    })
    expect(input('Label')).toHaveValue('Fans')
    commit(input('Label'), 'Loyal shoppers')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { metrics: [{ metric: 'customers', label: 'Loyal shoppers' }] } })
    commit(input('Label'), '  ')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { metrics: [{ metric: 'customers', label: 'Happy customers' }] } })
  })

  it('saves the heading as a row column', () => {
    const { onSave } = renderEditor(ValueStatsEditor, 'value_stats')
    commit(input('Heading'), 'Our numbers')
    expect(onSave).toHaveBeenCalledWith('sec-1', { title: 'Our numbers' })
  })

  it('disables the ticks and labels without write access', () => {
    renderEditor(ValueStatsEditor, 'value_stats', {}, { canWrite: false })
    expect(screen.getByRole('checkbox', { name: 'Orders shipped' })).toBeDisabled()
    expect(input('Label', 0)).toBeDisabled()
  })
})
