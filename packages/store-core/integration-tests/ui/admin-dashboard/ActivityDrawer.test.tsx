import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { ActivityDrawer, activityToCsv } from '@/components/admin/dashboard/ActivityDrawer'
import { makeActivity, mockReducedMotion } from './fixtures'

const activity = makeActivity(4)

function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w })
}

function renderDrawer(props: Partial<React.ComponentProps<typeof ActivityDrawer>> = {}) {
  const onClose = vi.fn()
  const onRefetch = vi.fn()
  const utils = render(<ActivityDrawer activity={activity} open onClose={onClose} onRefetch={onRefetch} storeName="Halo Audio" {...props} />)
  return { onClose, onRefetch, ...utils }
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

  it('opens in 3D on wide screens and in Grid below 640px, and the toggle switches', () => {
    const { container, unmount } = renderDrawer()
    expect(screen.getByRole('radio', { name: '3D' })).toHaveAttribute('aria-checked', 'true')
    expect(document.querySelectorAll('[data-prism]')).toHaveLength(28)
    fireEvent.click(screen.getByRole('radio', { name: 'Grid' }))
    expect(document.querySelectorAll('[data-prism]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-dot]')).toHaveLength(28)
    unmount()
    setWidth(390)
    renderDrawer()
    expect(screen.getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true')
    expect(document.querySelectorAll('[data-dot]')).toHaveLength(28)
    fireEvent.click(screen.getByRole('radio', { name: '3D' }))
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
    const onRefetch = vi.fn()
    function Host() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>open drawer</button>
          <ActivityDrawer activity={activity} open={open} onClose={() => setOpen(false)} onRefetch={onRefetch} />
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
    const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),select,[tabindex]:not([tabindex="-1"])'))
    const last = items[items.length - 1]
    last.focus()
    fireEvent.keyDown(dialog.querySelector('[tabindex="-1"]')!, { key: 'Tab' })
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('refetches with the right args from the period and channel selects', () => {
    const { onRefetch } = renderDrawer()
    fireEvent.change(screen.getByRole('combobox', { name: 'Period' }), { target: { value: '52' } })
    expect(onRefetch).toHaveBeenLastCalledWith({ weeks: 52, channel: 'all' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Channel' }), { target: { value: 'cod' } })
    expect(onRefetch).toHaveBeenLastCalledWith({ weeks: 52, channel: 'cod' })
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('52')
    expect(screen.getByRole('option', { name: 'Last 13 weeks' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'All channels' })).toBeInTheDocument()
  })

  it('shows a skeleton instead of the charts while loading', () => {
    const { container } = renderDrawer({ loading: true })
    expect(document.querySelector('[data-skeleton]')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Orders shipped per day/ })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Period' })).toBeInTheDocument()
    expect(container).toBeDefined()
  })

  it('builds CSV rows from the days series', () => {
    const csv = activityToCsv([
      { date: '2026-01-05', shipped: 4, placed: 5, customers: 3, top: [{ name: 'Shirts', count: 2 }, { name: 'Shoes, kids', count: 1 }] },
      { date: '2026-01-06', shipped: 0, placed: 0, customers: 0, top: [] },
    ])
    expect(csv.split('\n')).toEqual(['date,shipped,placed,customers,top_categories', '2026-01-05,4,5,3,"Shirts:2|Shoes, kids:1"', '2026-01-06,0,0,0,'])
  })

  it('Export CSV downloads the days as a file', async () => {
    let blob: Blob | null = null
    const create = vi.fn((b: Blob) => {
      blob = b
      return 'blob:mock'
    })
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(create).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:mock')
    const text = await new Promise<string>(resolve => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.readAsText(blob!)
    })
    const lines = text.split('\n')
    expect(lines).toHaveLength(29)
    expect(lines[0]).toBe('date,shipped,placed,customers,top_categories')
    expect(lines[1]).toMatch(/^2026-01-05,0,1,0,$/)
  })
})
