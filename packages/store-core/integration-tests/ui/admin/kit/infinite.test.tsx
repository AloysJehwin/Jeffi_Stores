import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, renderHook, waitFor, act } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams('tab=a&page=2'),
  usePathname: () => '/shop',
}))
vi.mock('@/lib/client/agent-events', () => ({ useAgentChanges: () => {} }))

import {
  InfiniteFooter, useInfiniteList, fetchJson, useReveal, useServerPages, ServerPagedItems,
} from '@/components/admin/kit/infinite'

const ctl = (o: any = {}) => ({ total: null, hasMore: false, loadingMore: false, error: null, loadMore: vi.fn(), ...o })

beforeEach(() => {
  push.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

describe('InfiniteFooter', () => {
  it('renders nothing with no rows and nothing more', () => {
    const { container } = render(<InfiniteFooter shown={0} control={ctl()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the count with a total and the noun', () => {
    render(<InfiniteFooter shown={25} noun="orders" control={ctl({ total: 80 })} />)
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 25 of 80 orders')
  })

  it('omits the total when it is smaller than shown', () => {
    render(<InfiniteFooter shown={25} control={ctl({ total: 10 })} />)
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 25 rows')
  })

  it('has a Load more button that calls loadMore when auto loading is off', () => {
    const loadMore = vi.fn()
    render(<InfiniteFooter shown={5} control={ctl({ hasMore: true, loadMore, auto: false })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(loadMore).toHaveBeenCalledTimes(1)
  })

  it('renders a next link whose plain click loads in place and modified click follows it', () => {
    const loadMore = vi.fn()
    render(<InfiniteFooter shown={5} control={ctl({ hasMore: true, loadMore, auto: false, href: '/shop?page=3' })} />)
    const link = screen.getByRole('link', { name: 'Load more' })
    expect(link).toHaveAttribute('href', '/shop?page=3')
    expect(link).toHaveAttribute('rel', 'next')
    fireEvent.click(link)
    expect(loadMore).toHaveBeenCalledTimes(1)
    fireEvent.click(link, { ctrlKey: true })
    expect(loadMore).toHaveBeenCalledTimes(1)
  })

  it('shows a loading row while fetching more', () => {
    render(<InfiniteFooter shown={5} control={ctl({ hasMore: true, loadingMore: true })} />)
    expect(screen.getByText('Loading more...')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('shows an error alert with Retry (retry preferred over loadMore)', () => {
    const retry = vi.fn()
    const loadMore = vi.fn()
    render(<InfiniteFooter shown={5} control={ctl({ error: 'Boom', retry, loadMore })} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Boom')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(loadMore).not.toHaveBeenCalled()
  })
})

describe('useInfiniteList', () => {
  it('loads page 1, appends page 2 (de-duplicated) and finishes at the total', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }], total: 3 })
      .mockResolvedValueOnce({ rows: [{ id: 2 }, { id: 3 }], total: 3 })
    const { result } = renderHook(() => useInfiniteList<{ id: number }>({ key: 'q', pageSize: 2, fetchPage, getKey: r => r.id }))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    expect(result.current.hasMore).toBe(true)
    expect(result.current.total).toBe(3)
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.rows.map(r => r.id)).toEqual([1, 2, 3]))
    expect(fetchPage.mock.calls[1][0]).toBe(2)
    expect(result.current.hasMore).toBe(false)
  })

  it('reports an error on the first page and recovers on retry', async () => {
    const fetchPage = vi.fn().mockRejectedValueOnce(new Error('Server said no')).mockResolvedValueOnce({ rows: [{ id: 1 }], total: 1 })
    const { result } = renderHook(() => useInfiniteList<{ id: number }>({ key: 'q', pageSize: 5, fetchPage }))
    await waitFor(() => expect(result.current.error).toBe('Server said no'))
    expect(result.current.rows).toEqual([])
    act(() => result.current.retry!())
    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    expect(result.current.error).toBeNull()
  })

  it('does not fetch while the key is null and refetches page 1 on reload', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ rows: [{ id: 1 }], total: 1 })
    const paused = renderHook(() => useInfiniteList<{ id: number }>({ key: null, pageSize: 5, fetchPage }))
    expect(paused.result.current.loading).toBe(false)
    expect(fetchPage).not.toHaveBeenCalled()
    const { result } = renderHook(() => useInfiniteList<{ id: number }>({ key: 'k', pageSize: 5, fetchPage }))
    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    act(() => result.current.reload())
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2))
    expect(fetchPage.mock.calls[1][0]).toBe(1)
  })

  it('setRows edits the loaded rows locally', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }], total: 2 })
    const { result } = renderHook(() => useInfiniteList<{ id: number }>({ key: 'k', pageSize: 5, fetchPage }))
    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    act(() => result.current.setRows(r => r.filter(x => x.id !== 1)))
    expect(result.current.rows).toEqual([{ id: 2 }])
  })
})

describe('fetchJson', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ a: 1 }) }))
    expect(await fetchJson('/api/x')).toEqual({ a: 1 })
  })

  it('throws the API error or a status fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({ error: 'Bad thing' }) }))
    await expect(fetchJson('/api/x')).rejects.toThrow('Bad thing')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.reject(new Error('x')) }))
    await expect(fetchJson('/api/x')).rejects.toThrow('Request failed (502)')
  })
})

describe('useReveal', () => {
  it('shows pageSize rows, reveals more, and resets when the key changes', () => {
    const rows = Array.from({ length: 25 }, (_, i) => i)
    const { result, rerender } = renderHook(({ k }) => useReveal(rows, 10, k), { initialProps: { k: 'a' } })
    expect(result.current.shown).toHaveLength(10)
    expect(result.current.control).toMatchObject({ total: 25, hasMore: true })
    act(() => result.current.control.loadMore())
    expect(result.current.shown).toHaveLength(20)
    act(() => result.current.control.loadMore())
    expect(result.current.shown).toHaveLength(25)
    expect(result.current.control.hasMore).toBe(false)
    rerender({ k: 'b' })
    expect(result.current.shown).toHaveLength(10)
  })
})

describe('useServerPages', () => {
  const rows = [{ id: 'a' }, { id: 'b' }]

  it('appends the next page from loadPage and stops once the total is reached', async () => {
    const loadPage = vi.fn().mockResolvedValue({ rows: [{ id: 'b' }, { id: 'c' }], total: 3 })
    const { result } = renderHook(() => useServerPages({ rows, page: 1, total: 3, rowKey: r => r.id, loadPage, pageSize: 2 }))
    expect(result.current.control.hasMore).toBe(true)
    expect(result.current.control.href).toBe('/shop?tab=a&page=2')
    act(() => result.current.control.loadMore())
    await waitFor(() => expect(result.current.rows.map(r => r.id)).toEqual(['a', 'b', 'c']))
    expect(loadPage).toHaveBeenCalledWith(2)
    await waitFor(() => expect(result.current.control.hasMore).toBe(false))
    expect(result.current.shown).toBe(3)
  })

  it('surfaces a load error and lets retry try again', async () => {
    const loadPage = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([{ id: 'c' }])
    const { result } = renderHook(() => useServerPages({ rows, page: 1, total: 3, rowKey: r => r.id, loadPage, pageSize: 2 }))
    act(() => result.current.control.loadMore())
    await waitFor(() => expect(result.current.control.error).toBe('offline'))
    act(() => result.current.control.retry!())
    await waitFor(() => expect(result.current.rows).toHaveLength(3))
  })

  it('without loadPage the next page is a navigation', () => {
    const { result } = renderHook(() => useServerPages({ rows, page: 1, total: 5, rowKey: r => r.id, pageSize: 2, pageHref: p => `/p/${p}` }))
    expect(result.current.control.auto).toBe(false)
    act(() => result.current.control.loadMore())
    expect(push).toHaveBeenCalledWith('/p/2')
  })

  it('counts extras separately from the paged total', () => {
    const items = [{ id: 'a' }, { id: 'promo', extra: true }, { id: 'b' }]
    const { result } = renderHook(() => useServerPages({ rows: items, page: 1, total: 2, rowKey: r => r.id, isExtra: (r: any) => !!r.extra, pageSize: 2 }))
    expect(result.current.shown).toBe(2)
    expect(result.current.control.hasMore).toBe(false)
  })
})

describe('ServerPagedItems', () => {
  const items = [
    { key: '1', node: <li>One</li> },
    { key: '2', node: <li>Two</li> },
  ]

  it('renders the nodes inside the chosen wrapper with the footer count', () => {
    render(<ServerPagedItems items={items} page={1} total={2} wrap="ul" noun="things" />)
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 2 of 2 things')
  })

  it('appends loaded items and puts a tbody footer in a tfoot', async () => {
    const loadPage = vi.fn().mockResolvedValue({ rows: [{ key: '3', node: <tr><td>Three</td></tr> }], total: 3 })
    render(
      <table>
        <ServerPagedItems items={[{ key: '1', node: <tr><td>One</td></tr> }, { key: '2', node: <tr><td>Two</td></tr> }]} page={1} total={3} wrap="tbody" loadPage={loadPage} pageSize={2} />
      </table>
    )
    expect(document.querySelector('tfoot')).not.toBeNull()
    fireEvent.click(screen.getByRole('link', { name: 'Load more' }))
    expect(await screen.findByText('Three')).toBeInTheDocument()
  })
})
