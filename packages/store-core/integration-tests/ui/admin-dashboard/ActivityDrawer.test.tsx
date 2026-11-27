import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { ActivityDrawer } from '@/components/admin/dashboard/ActivityDrawer'
import { makeActivity, mockReducedMotion } from './fixtures'

const exportProps = vi.hoisted(() => ({ last: null as any }))
vi.mock('@/components/admin/export/ExportButton', () => ({
  ExportButton: (p: any) => {
    exportProps.last = p
    return <button type="button">Export</button>
  },
}))

const activity = makeActivity(4)

function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w })
}

function renderDrawer(props: Partial<React.ComponentProps<typeof ActivityDrawer>> = {}) {
  const onClose = vi.fn()
  const load = vi.fn(async ({ weeks, channel }: { weeks: number; channel: string }) => ({ ...makeActivity(weeks === 52 ? 8 : 4), channel }) as typeof activity)
  const utils = render(<ActivityDrawer activity={activity} open onClose={onClose} load={load} storeName="Halo Audio" {...props} />)
  return { onClose, load, ...utils }
}

const pick = (name: string, option: string) => {
  fireEvent.click(screen.getByRole('combobox', { name }))
  fireEvent.click(screen.getByRole('option', { name: option }))
}

describe('ActivityDrawer', () => {
  beforeEach(() => {
    mockReducedMotion(true)
    setWidth(1280)
  })

  it('renders nothing while closed', () => {
    renderDrawer({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the title, store and range, the stat strip and every section', () => {
    renderDrawer()
    const dialog = screen.getByRole('dialog', { name: 'Orders shipped' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByText(/Halo Audio · 5 Jan – 1 Feb/)).toBeInTheDocument()
    expect(within(dialog).getByText('4-week total')).toBeInTheDocument()
    expect(within(dialog).getByText('Busiest day')).toBeInTheDocument()
    expect(within(dialog).getByText('Longest streak')).toBeInTheDocument()
    expect(within(dialog).getByText('Current streak')).toBeInTheDocument()
    expect(within(dialog).getByRole('img', { name: /Orders shipped per day/ })).toBeInTheDocument()
    for (const h of ['Weekday rhythm', 'Time to ship', 'Throughput · weekly', 'Top products shipped']) expect(within(dialog).getByRole('heading', { name: h })).toBeInTheDocument()
    expect(within(dialog).getByText('Linen shirt')).toBeInTheDocument()
  })

  it('opens in 3D on wide screens and in Grid below 640px, and the segmented toggle switches', () => {
    const { container, unmount } = renderDrawer()
    expect(screen.getByRole('group', { name: 'Chart view' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '3D' })).toHaveClass('bg-accent-500')
    expect(document.querySelectorAll('[data-prism]')).toHaveLength(28)
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }))
    expect(document.querySelectorAll('[data-prism]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-dot]')).toHaveLength(28)
    unmount()
    setWidth(390)
    renderDrawer()
    expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelectorAll('[data-dot]')).toHaveLength(28)
    fireEvent.click(screen.getByRole('button', { name: '3D' }))
    expect(document.querySelectorAll('[data-prism]')).toHaveLength(28)
    expect(container).toBeDefined()
  })

  it('Esc and the close button close it; the backdrop too', () => {
    const { onClose } = renderDrawer()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('dialog').firstElementChild!)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('returns focus to the opener and unlocks scroll when closed', async () => {
    const load = vi.fn(async () => null)
    function Host() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>open drawer</button>
          <ActivityDrawer activity={activity} open={open} onClose={() => setOpen(false)} load={load} />
        </>
      )
    }
    render(<Host />)
    const opener = screen.getByRole('button', { name: 'open drawer' })
    opener.focus()
    fireEvent.click(opener)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('traps Tab inside the panel', () => {
    renderDrawer()
    const dialog = screen.getByRole('dialog')
    const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),[tabindex]:not([tabindex="-1"])'))
    const last = items[items.length - 1]
    last.focus()
    fireEvent.keyDown(dialog.querySelector('[tabindex="-1"]')!, { key: 'Tab' })
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('starts from the dashboard activity without loading, and loads through the period and channel selects', async () => {
    const { load } = renderDrawer()
    expect(load).not.toHaveBeenCalled()
    // a span outside 13 / 26 / 52 (the 4-week fixture) joins the options instead of blanking the select
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveTextContent('Last 4 weeks')
    expect(screen.getByRole('combobox', { name: 'Channel' })).toHaveTextContent('All channels')
    fireEvent.click(screen.getByRole('combobox', { name: 'Period' }))
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Last 4 weeks', 'Last 13 weeks', 'Last 26 weeks', 'Last 52 weeks'])
    fireEvent.click(screen.getByRole('option', { name: 'Last 52 weeks' }))
    await waitFor(() => expect(load).toHaveBeenLastCalledWith({ weeks: 52, channel: 'all' }))
    await waitFor(() => expect(screen.getByText('8-week total')).toBeInTheDocument())
    expect(document.querySelectorAll('[data-prism]')).toHaveLength(56)
    pick('Channel', 'COD')
    await waitFor(() => expect(load).toHaveBeenLastCalledWith({ weeks: 52, channel: 'cod' }))
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveTextContent('Last 52 weeks')
    expect(screen.getByRole('combobox', { name: 'Channel' })).toHaveTextContent('COD')
  })

  it('shows a skeleton instead of the charts while loading, keeping the stats', async () => {
    const load = vi.fn(() => new Promise<null>(() => {}))
    renderDrawer({ load })
    pick('Period', 'Last 13 weeks')
    await waitFor(() => expect(document.querySelector('[data-skeleton]')).toBeInTheDocument())
    expect(screen.getByRole('dialog')).toHaveTextContent('4-week total')
    expect(screen.queryByRole('img', { name: /Orders shipped per day/ })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Period' })).toBeInTheDocument()
  })

  it('exports through the standard Export with the drawer period and channel', async () => {
    renderDrawer()
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(exportProps.last.exportKey).toBe('dashboard.activity')
    expect(exportProps.last.query).toMatch(/^weeks=\d+&filter=/)
    expect(exportProps.last.filters.channels.length).toBeGreaterThan(0)
  })
})
