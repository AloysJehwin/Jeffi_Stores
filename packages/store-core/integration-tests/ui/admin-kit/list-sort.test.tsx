import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SortArrow, SortTh } from '@/components/admin/kit/list-sort'

// next/navigation: usePathname/useSearchParams drive the sort state; useRouter.push captures the
// URL the header click would navigate to.
const push = vi.fn<(...a: any[]) => any>()
let search = ''
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/orders',
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}))

beforeEach(() => {
  push.mockClear()
  search = ''
})

describe('SortArrow (branches)', () => {
  it('renders distinct icons for asc / desc / unsorted', () => {
    const { container: asc } = render(<SortArrow state="asc" />)
    const { container: desc } = render(<SortArrow state="desc" />)
    const { container: none } = render(<SortArrow state={null} />)
    // unsorted arrow is dimmed via opacity-30.
    expect(none.querySelector('.opacity-30')).toBeInTheDocument()
    expect(asc.querySelector('.opacity-30')).toBeNull()
    expect(desc.querySelector('.opacity-30')).toBeNull()
  })
})

function table(children: React.ReactNode) {
  return (
    <table>
      <thead>
        <tr>{children}</tr>
      </thead>
    </table>
  )
}

describe('SortTh (render + interaction)', () => {
  it('renders the column label and is not sorted when the URL has no sort', () => {
    render(table(<SortTh col={{ key: 'total', label: 'Total', type: 'number' }} />))
    const th = screen.getByText('Total').closest('th')!
    expect(th).not.toHaveAttribute('aria-sort')
  })

  it('reflects the active sort direction from the URL as aria-sort', () => {
    search = 'sort=total&dir=asc'
    render(table(<SortTh col={{ key: 'total', label: 'Total', type: 'number' }} />))
    expect(screen.getByText('Total').closest('th')).toHaveAttribute('aria-sort', 'ascending')
  })

  it('clicking an unsorted numeric column pushes its natural (desc) direction', () => {
    render(table(<SortTh col={{ key: 'total', label: 'Total', type: 'number' }} />))
    fireEvent.click(screen.getByText('Total'))
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0][0]).toContain('sort=total')
    expect(push.mock.calls[0][0]).toContain('dir=desc')
  })

  it('clicking a text column active in its natural (asc) dir flips to desc', () => {
    search = 'sort=name&dir=asc'
    render(table(<SortTh col={{ key: 'name', label: 'Name', type: 'text' }} />))
    fireEvent.click(screen.getByText('Name'))
    expect(push.mock.calls[0][0]).toContain('dir=desc')
  })

  it('clicking a column already flipped clears the sort from the URL', () => {
    // text natural is asc; dir=desc is the flipped state, so the next click clears.
    search = 'sort=name&dir=desc'
    render(table(<SortTh col={{ key: 'name', label: 'Name', type: 'text' }} />))
    fireEvent.click(screen.getByText('Name'))
    expect(push.mock.calls[0][0]).not.toContain('sort=')
  })
})
