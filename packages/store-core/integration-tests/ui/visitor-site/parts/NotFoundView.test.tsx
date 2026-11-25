import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const site = vi.hoisted(() => ({ categories: vi.fn() }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/lib/site/data', () => ({ siteData: () => ({ categories: site.categories }) }))

import NotFoundView from '@/components/visitor/site/code/parts/utility/NotFoundView'

const cats = [{ id: 'c1', name: 'Tools', url: '/categories/tools' }, { id: 'c2', name: 'Paint', url: '/categories/paint' }]

describe('NotFoundView', () => {
  it('shows the 404 heading, a search form, popular categories and the main pages', async () => {
    site.categories.mockResolvedValue(cats)
    render(await NotFoundView({}))
    expect(screen.getByText('404')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /couldn.t find that page/ })).toBeInTheDocument()
    const form = screen.getByRole('search')
    expect(form).toHaveAttribute('action', '/products')
    expect(screen.getByRole('searchbox', { name: 'Search the store' })).toHaveAttribute('name', 'search')
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Tools' })).toHaveAttribute('href', '/categories/tools')
    expect(screen.getByText('Popular categories')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main pages' })
    expect(nav).toHaveTextContent('HomeAll productsAll categoriesHelp and support')
    expect(screen.getByRole('link', { name: 'Help and support' })).toHaveAttribute('href', '/support')
    expect(site.categories).toHaveBeenCalledWith({ parent: null, limit: 8 })
  })

  it('draws bare, without the heading, for a design that writes its own', async () => {
    site.categories.mockResolvedValue([])
    render(await NotFoundView({ bare: true }))
    expect(screen.queryByText('404')).toBeNull()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByRole('search')).toBeInTheDocument()
  })

  it('omits the category list when there are none or the lookup fails, and uses supplied data', async () => {
    site.categories.mockResolvedValue([])
    const { unmount } = render(await NotFoundView({}))
    expect(screen.queryByText('Popular categories')).toBeNull()
    unmount()
    const own = { categories: vi.fn().mockRejectedValue(new Error('x')) } as any
    render(await NotFoundView({ data: own }))
    expect(own.categories).toHaveBeenCalled()
    expect(screen.queryByText('Popular categories')).toBeNull()
  })
})
