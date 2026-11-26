import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { InsightsDrawer, insightsIsoDays, type InsightsDrawerProps } from '@/components/admin/insights/InsightsDrawer'
import { weekdaySection, weeklySection } from '@/components/admin/insights/sections'
import { mondayGrid, summarize, type InsightsSeries } from '@/lib/insights/series'
import { mockReducedMotion } from '../../admin-dashboard/fixtures'

type Extra = { note: string }
const TODAY = '2026-01-14'
const COPY = { subject: 'Return requests', unit: 'requests', noun: 'returns', empty: 'No returns in this range.' }
const FILTER = {
  label: 'Type',
  options: [
    { value: 'all', label: 'All types' },
    { value: 'refund', label: 'Refunds' },
  ],
}

function makeSeries(weeks: number, filter: string | null = 'all', series = 2): InsightsSeries<Extra> {
  const grid = mondayGrid(TODAY, weeks)
  const days = grid.dates.map((date, i) => ({ date, values: [i % 3 === 0 ? 0 : i, i % 2, 1].slice(0, series) }))
  const defs = [
    { key: 'requested', label: 'Requested' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
  ].slice(0, series)
  return { weeks, filter, from: grid.from, to: grid.to, today: TODAY, series: defs, days, totals: summarize(days, TODAY), extra: { note: `extra for ${weeks} weeks` } }
}

function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w })
}

function renderDrawer(props: Partial<InsightsDrawerProps<Extra>> = {}) {
  const onClose = vi.fn()
  const load = vi.fn(async (q: { weeks: number; filter: string | null }) => makeSeries(q.weeks, q.filter))
  const utils = render(
    <InsightsDrawer<Extra>
      open
      onClose={onClose}
      title="Return requests"
      subtitle="Halo Audio"
      copy={COPY}
      periods={[2, 4]}
      filter={FILTER}
      load={load}
      sections={[weekdaySection(), { title: 'Notes', half: true, render: (s, copy) => <p>{`${s.extra?.note} · ${copy.noun}`}</p> }, weeklySection()]}
      {...props}
    />
  )
  return { onClose, load, ...utils }
}

const readBlob = (b: Blob) =>
  new Promise<string>(resolve => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.readAsText(b)
  })

const pick = (name: string, option: string) => {
  fireEvent.click(screen.getByRole('combobox', { name }))
  fireEvent.click(screen.getByRole('option', { name: option }))
}

describe('InsightsDrawer', () => {
  beforeEach(() => {
    mockReducedMotion(true)
    setWidth(1280)
  })

  it('renders nothing while closed and does not load', () => {
    const { load } = renderDrawer({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(load).not.toHaveBeenCalled()
  })

  it('loads on open, showing a skeleton until the series arrives', async () => {
    const { load } = renderDrawer()
    const dialog = screen.getByRole('dialog', { name: 'Return requests' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.querySelector('[data-skeleton]')).toBeInTheDocument()
    expect(within(dialog).getByText('Halo Audio · Last 2 weeks')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Export CSV' })).toBeDisabled()
    await waitFor(() => expect(load).toHaveBeenCalledWith({ weeks: 2, filter: 'all' }))
    await waitFor(() => expect(within(dialog).getByRole('img', { name: /^Return requests per day over 2 weeks/ })).toBeInTheDocument())
    expect(within(dialog).getByText('Halo Audio · 5 Jan – 18 Jan')).toBeInTheDocument()
    expect(dialog.querySelector('[data-skeleton]')).not.toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('shows the default stat strip, the 3D chart and the sections, pairing half sections', async () => {
    renderDrawer()
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(within(dialog).getByText('2-week total')).toBeInTheDocument())
    const strip = dialog.querySelector('[data-stats]') as HTMLElement
    for (const t of ['2-week total', 'returns', 'Busiest day', 'Longest streak', 'Current streak']) expect(within(strip).getByText(t)).toBeInTheDocument()
    expect(document.querySelectorAll('[data-prism]')).toHaveLength(14)
    const weekday = within(dialog).getByRole('heading', { name: 'Weekday rhythm' }).closest('section')!
    const notes = within(dialog).getByRole('heading', { name: 'Notes' }).closest('section')!
    expect(weekday.parentElement).toBe(notes.parentElement)
    expect(weekday.parentElement).toHaveClass('sm:grid-cols-2')
    expect(within(notes).getByText('extra for 2 weeks · returns')).toBeInTheDocument()
    const weekly = within(dialog).getByRole('heading', { name: 'Weekly' }).closest('section')!
    expect(within(weekly).getByText('Requested')).toBeInTheDocument()
    expect(within(weekly).getByText('Approved')).toBeInTheDocument()
    expect(within(weekly).getByRole('group', { name: /^Weekly return requests, 2 weeks/ })).toBeInTheDocument()
  })

  it('splits the tooltip by series when the days carry no top list', async () => {
    renderDrawer()
    await waitFor(() => expect(document.querySelectorAll('[data-prism]')).toHaveLength(14))
    fireEvent.pointerEnter(document.querySelector('[data-prism="5"]')!)
    const tip = screen.getByRole('tooltip')
    expect(within(tip).getByText('Requested')).toBeInTheDocument()
    expect(within(tip).getByText('Approved')).toBeInTheDocument()
    expect(within(tip).getByText('6')).toBeInTheDocument()
    expect(within(tip).getByText(/^requests · /)).toBeInTheDocument()
  })

  it('uses the segmented control for 3D and Grid', async () => {
    renderDrawer()
    await waitFor(() => expect(document.querySelectorAll('[data-prism]')).toHaveLength(14))
    expect(screen.getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }))
    expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelectorAll('[data-dot]')).toHaveLength(14)
  })

  it('reloads through the period and filter selects', async () => {
    const { load } = renderDrawer()
    await waitFor(() => expect(screen.getByText('2-week total')).toBeInTheDocument())
    pick('Period', 'Last 4 weeks')
    await waitFor(() => expect(screen.getByText('4-week total')).toBeInTheDocument())
    expect(load).toHaveBeenLastCalledWith({ weeks: 4, filter: 'all' })
    pick('Type', 'Refunds')
    await waitFor(() => expect(load).toHaveBeenLastCalledWith({ weeks: 4, filter: 'refund' }))
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveTextContent('Refunds')
  })

  it('starts from `initial` without loading', () => {
    const { load } = renderDrawer({ initial: makeSeries(4, 'refund') })
    expect(load).not.toHaveBeenCalled()
    expect(screen.getByText('4-week total')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveTextContent('Last 4 weeks')
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveTextContent('Refunds')
  })

  it('ignores a slow response for an older query', async () => {
    const pending: Record<number, (s: InsightsSeries<Extra>) => void> = {}
    const load = vi.fn((q: { weeks: number; filter: string | null }) => new Promise<InsightsSeries<Extra>>(r => (pending[q.weeks] = r)))
    renderDrawer({ load })
    await waitFor(() => expect(pending[2]).toBeDefined())
    pick('Period', 'Last 4 weeks')
    await waitFor(() => expect(pending[4]).toBeDefined())
    pending[4](makeSeries(4))
    await waitFor(() => expect(screen.getByText('4-week total')).toBeInTheDocument())
    pending[2](makeSeries(2))
    await new Promise(r => setTimeout(r, 0))
    expect(screen.getByText('4-week total')).toBeInTheDocument()
  })

  it('shows an error with a retry when the load fails or throws', async () => {
    const load = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('down')).mockImplementation(async (q: { weeks: number; filter: string | null }) => makeSeries(q.weeks, q.filter))
    renderDrawer({ load })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Insights are unavailable right now.')
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByText('2-week total')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('Esc closes an open select first, then the drawer; the X and the backdrop close it', async () => {
    const { onClose } = renderDrawer()
    const period = screen.getByRole('combobox', { name: 'Period' })
    fireEvent.click(period)
    expect(period).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(period, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(period).toHaveAttribute('aria-expanded', 'false')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('dialog').firstElementChild!)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('is full screen on phones and a 560px sheet from md up, opening in Grid below 640px', async () => {
    setWidth(390)
    renderDrawer()
    const panel = screen.getByRole('dialog').querySelector('[tabindex="-1"]')!
    expect(panel).toHaveClass('w-full', 'inset-y-0', 'md:max-w-[560px]')
    await waitFor(() => expect(document.querySelectorAll('[data-dot]')).toHaveLength(14))
    expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('exports the series as CSV named after the title, or a custom CSV, and can hide Export', async () => {
    let blob: Blob | null = null
    Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => ((blob = b), 'blob:x')), revokeObjectURL: vi.fn() })
    let name = ''
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download
    })
    const { unmount } = renderDrawer()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export CSV' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(click).toHaveBeenCalledTimes(1)
    expect(name).toBe('return-requests-2026-01-05_2026-01-18.csv')
    const text = await readBlob(blob as unknown as Blob)
    expect(text.split('\n')[0]).toBe('date,requested,approved,total')
    expect(text.split('\n')).toHaveLength(15)
    unmount()
    renderDrawer({ exportName: 'returns', toCsv: s => `custom ${s.weeks}` })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export CSV' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(name).toBe('returns-2026-01-05_2026-01-18.csv')
    expect(await readBlob(blob as unknown as Blob)).toBe('custom 2')
    click.mockRestore()
  })

  it('takes custom stats and hides Export with exportName false', async () => {
    renderDrawer({ exportName: false, stats: s => [{ label: 'Approved', value: s.days.reduce((n, d) => n + d.values[1], 0), accent: true }] })
    await waitFor(() => expect(screen.getByText('Approved', { selector: '[data-stats] p' })).toBeInTheDocument())
    expect(screen.queryByText('Busiest day')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument()
  })
})

describe('insights sections and cells', () => {
  it('weeklySection draws one line for one series and the stacked total for three', () => {
    const one = render(<>{weeklySection({ title: 'Trend' }).render(makeSeries(2, null, 1), COPY)}</>)
    expect(one.container.querySelector('[data-line="placed"]')).toBeNull()
    expect(within(one.container).getByText('Requested')).toBeInTheDocument()
    one.unmount()
    const three = render(<>{weeklySection().render(makeSeries(2, null, 3), COPY)}</>)
    expect(within(three.container).getByText('Total')).toBeInTheDocument()
    expect(three.container.querySelector('[data-line="placed"]')).toBeNull()
  })

  it('weekdaySection falls back to the copy empty text', () => {
    const s = makeSeries(2, null, 1)
    const empty = { ...s, days: s.days.map(d => ({ ...d, values: [0] })) }
    render(<>{weekdaySection().render(empty, COPY)}</>)
    expect(screen.getByText('No returns in this range.')).toBeInTheDocument()
  })

  it('insightsIsoDays prefers a day’s own top list and keeps notes', () => {
    const s = makeSeries(1, null, 2)
    s.days[1] = { ...s.days[1], top: [{ name: 'Damaged', count: 2 }], note: '2 customers' }
    const cells = insightsIsoDays(s)
    expect(cells[1]).toEqual({ date: s.days[1].date, value: 2, parts: [{ name: 'Damaged', count: 2 }], note: '2 customers' })
    expect(cells[2].parts).toEqual([{ name: 'Requested', count: 2 }])
  })
})
