import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Pagination from '@/components/ui/Pagination'

const href = (p: number) => `/list?page=${p}`

describe('Pagination (render + branches)', () => {
  it('renders nothing when there is one page or fewer', () => {
    const { container } = render(<Pagination page={1} totalPages={1} buildHref={href} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders page position and both controls when multiple pages', () => {
    render(<Pagination page={2} totalPages={5} buildHref={href} />)
    expect(screen.getByText('2/5')).toBeInTheDocument()
    expect(screen.getByText('Prev')).toHaveAttribute('href', '/list?page=1')
    expect(screen.getByText('Next')).toHaveAttribute('href', '/list?page=3')
  })

  it('disables Prev on the first page', () => {
    render(<Pagination page={1} totalPages={5} buildHref={href} />)
    expect(screen.getByText('Prev')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('Next')).toHaveAttribute('aria-disabled', 'false')
  })

  it('disables Next on the last page', () => {
    render(<Pagination page={5} totalPages={5} buildHref={href} />)
    expect(screen.getByText('Next')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('Prev')).toHaveAttribute('aria-disabled', 'false')
  })
})
