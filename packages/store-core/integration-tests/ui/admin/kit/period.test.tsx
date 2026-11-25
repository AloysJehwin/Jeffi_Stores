import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, renderHook, waitFor } from '@testing-library/react'

const replace = vi.fn()
let search = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => '/admin/overview',
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('@/components/ui/DatePicker', () => ({
  default: ({ value, onChange, ...rest }: any) => <input aria-label={rest['aria-label']} value={value} onChange={e => onChange(e.target.value)} />,
  formatDisplay: (v: string) => `D(${v})`,
}))
const apiMock = vi.fn()
vi.mock('@/components/admin/kit/core', () => ({ api: (...a: any[]) => apiMock(...a) }))

import { usePeriod, PeriodBar, useOverviewData, AttentionList, OverviewSkeleton } from '@/components/admin/kit/period'

beforeEach(() => {
  search = ''
  replace.mockClear()
  apiMock.mockReset()
})

describe('usePeriod', () => {
  it('defaults to the 30 day preset and writes from/to keeping other params', () => {
    search = 'tab=sales'
    const { result } = renderHook(() => usePeriod())
    const [period, set] = result.current
    expect(period.from < period.to).toBe(true)
    set({ from: '2026-01-01', to: '2026-01-31' })
    expect(replace).toHaveBeenCalledWith('/admin/overview?tab=sales&from=2026-01-01&to=2026-01-31', { scroll: false })
  })

  it('reads a valid ?from&to', () => {
    search = 'from=2025-01-01&to=2025-01-31'
    const { result } = renderHook(() => usePeriod())
    expect(result.current[0]).toEqual({ from: '2025-01-01', to: '2025-01-31' })
  })
})

describe('PeriodBar', () => {
  const value = { from: '2025-01-01', to: '2025-01-31' }

  it('shows presets, the date inputs and the comparison range', () => {
    render(<PeriodBar value={value} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: '7 days' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'This FY' })).toBeInTheDocument()
    expect(screen.getByLabelText('From')).toHaveValue('2025-01-01')
    expect(screen.getByLabelText('To')).toHaveValue('2025-01-31')
    expect(screen.getByText(/^vs D\(/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()
  })

  it('a preset click reports a new period', () => {
    const onChange = vi.fn()
    render(<PeriodBar value={value} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    const p = onChange.mock.calls[0][0]
    expect(p.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(p.to >= p.from).toBe(true)
  })

  it('editing a date keeps the other end, and ignores an empty value', () => {
    const onChange = vi.fn()
    render(<PeriodBar value={value} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2025-01-10' } })
    expect(onChange).toHaveBeenLastCalledWith({ from: '2025-01-10', to: '2025-01-31' })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2025-01-20' } })
    expect(onChange).toHaveBeenLastCalledWith({ from: '2025-01-01', to: '2025-01-20' })
    onChange.mockClear()
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('presets are a segmented control: a matching preset is pressed, a custom range presses none', () => {
    const { rerender } = render(<PeriodBar value={value} onChange={() => {}} />)
    expect(screen.getByRole('group', { name: 'Period presets' })).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0)
    const onChange = vi.fn()
    rerender(<PeriodBar value={value} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '30 days' }))
    rerender(<PeriodBar value={onChange.mock.calls[0][0]} onChange={onChange} />)
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '30 days' })).toHaveClass('bg-accent-500')
  })

  it('renders actions at the right, before Refresh', () => {
    render(<PeriodBar value={value} onChange={() => {}} onRefresh={() => {}} actions={<button type="button">Insights</button>} />)
    const insights = screen.getByRole('button', { name: 'Insights' })
    expect(insights.parentElement).toHaveClass('ml-auto')
    expect(screen.getByRole('button', { name: 'Refresh' })).not.toHaveClass('ml-auto')
    expect(insights.compareDocumentPosition(screen.getByRole('button', { name: 'Refresh' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('refresh button calls onRefresh and spins while busy', () => {
    const onRefresh = vi.fn()
    render(<PeriodBar value={value} onChange={() => {}} onRefresh={onRefresh} busy />)
    const btn = screen.getByRole('button', { name: 'Refresh' })
    expect(btn.querySelector('svg')).toHaveClass('animate-spin')
    fireEvent.click(btn)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})

describe('useOverviewData', () => {
  it('loads data for the url and reloads on demand', async () => {
    apiMock.mockResolvedValue({ ok: true, data: { n: 1 } })
    const { result } = renderHook(() => useOverviewData<{ n: number }>('/api/o?x=1'))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }))
    expect(result.current.loading).toBe(false)
    apiMock.mockResolvedValue({ ok: true, data: { n: 2 } })
    result.current.reload()
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }))
  })

  it('reports the API error, falling back to a generic one', async () => {
    apiMock.mockResolvedValueOnce({ ok: false, data: { error: 'Nope' } })
    const a = renderHook(() => useOverviewData('/api/a'))
    await waitFor(() => expect(a.result.current.error).toBe('Nope'))
    apiMock.mockResolvedValueOnce({ ok: false, data: {} })
    const b = renderHook(() => useOverviewData('/api/b'))
    await waitFor(() => expect(b.result.current.error).toBe('Failed to load'))
  })

  it('does not fetch without a url and never shows stale data for a new url', async () => {
    const idle = renderHook(() => useOverviewData(null))
    expect(idle.result.current.loading).toBe(false)
    expect(apiMock).not.toHaveBeenCalled()
    apiMock.mockResolvedValue({ ok: true, data: { u: 1 } })
    const { result, rerender } = renderHook(({ u }) => useOverviewData(u), { initialProps: { u: '/api/1' } })
    await waitFor(() => expect(result.current.data).toEqual({ u: 1 }))
    apiMock.mockResolvedValue(new Promise(() => {}))
    rerender({ u: '/api/2' })
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(true)
  })
})

describe('AttentionList', () => {
  it('shows the empty message when nothing needs attention', () => {
    render(<AttentionList items={[]} />)
    expect(screen.getByText('Nothing needs attention right now.')).toBeInTheDocument()
  })

  it('renders items as links when they have an href and plain rows otherwise', () => {
    render(
      <AttentionList
        title="Alerts"
        items={[
          { key: 'a', severity: 'critical', title: 'Payments failing', sub: 'since 9am', href: '/admin/payments' },
          { key: 'b', severity: 'info', title: 'FYI note' },
        ] as any}
      />
    )
    expect(screen.getByText('Alerts')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Payments failing/ })).toHaveAttribute('href', '/admin/payments')
    expect(screen.getByText('since 9am')).toBeInTheDocument()
    expect(screen.getByText('FYI note').closest('a')).toBeNull()
  })

  it('OverviewSkeleton renders placeholder cards', () => {
    const { container } = render(<OverviewSkeleton />)
    expect(container.querySelectorAll('.h-24')).toHaveLength(8)
  })
})
