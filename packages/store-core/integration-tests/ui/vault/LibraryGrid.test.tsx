import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { LibraryItem } from '@/lib/vault/library-filter'

// LibraryGrid renders the buyer's owned items as cards with category/brand facet chips and a shared
// search query. We stub useVaultSearch with local state so typing/filtering is exercised without the
// full VaultShell + next/navigation chrome.
let query = ''
const setQuery = vi.fn((q: string) => {
  query = q
})
vi.mock('@/components/vault/VaultShell', () => ({
  useVaultSearch: () => ({ query, setQuery }),
}))

import LibraryGrid from '@/components/vault/LibraryGrid'

const item = (over: Partial<LibraryItem>): LibraryItem => ({
  product_id: 'p1',
  title: 'Item',
  cover_url: null,
  source: 'purchase',
  access_expires_at: null,
  kinds: ['video'],
  file_count: 1,
  category: null,
  brand: null,
  ...over,
})

const items: LibraryItem[] = [
  item({ product_id: 'p1', title: 'Jazz Masterclass', kinds: ['video'], category: 'Music', brand: 'Halo' }),
  item({ product_id: 'p2', title: 'Ambient Pack', kinds: ['audio'], category: 'Music', brand: 'Mint' }),
  item({ product_id: 'p3', title: 'Design Handbook', kinds: ['pdf'], category: 'Books', brand: 'Halo', file_count: 3 }),
]

beforeEach(() => {
  query = ''
  setQuery.mockClear()
})

describe('LibraryGrid (render + filter)', () => {
  it('renders the empty state with a store link when there are no items', () => {
    render(<LibraryGrid items={[]} storeUrl="https://shop.test" />)
    expect(screen.getByText('No purchases yet')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Browse the store/ })
    expect(link).toHaveAttribute('href', 'https://shop.test')
  })

  it('renders a card per item with its title and item count', () => {
    render(<LibraryGrid items={items} storeUrl="https://shop.test" />)
    expect(screen.getByText('Jazz Masterclass')).toBeInTheDocument()
    expect(screen.getByText('Ambient Pack')).toBeInTheDocument()
    expect(screen.getByText('Design Handbook')).toBeInTheDocument()
    expect(screen.getByText('3 items')).toBeInTheDocument()
  })

  it('shows category facet chips and filters the grid when one is clicked', () => {
    render(<LibraryGrid items={items} storeUrl="https://shop.test" />)
    // Books category has one item; clicking it hides the two Music items.
    fireEvent.click(screen.getByRole('tab', { name: /Books/ }))
    expect(screen.getByText('Design Handbook')).toBeInTheDocument()
    expect(screen.queryByText('Jazz Masterclass')).not.toBeInTheDocument()
    expect(screen.queryByText('Ambient Pack')).not.toBeInTheDocument()
  })

  it('renders the no-matches state when the search query excludes everything', () => {
    query = 'nonexistent-term'
    render(<LibraryGrid items={items} storeUrl="https://shop.test" />)
    expect(screen.getByText('No matches')).toBeInTheDocument()
    // Clearing filters resets the shared query.
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(setQuery).toHaveBeenCalledWith('')
  })

  it('seeds the shared query from initialQuery', () => {
    render(<LibraryGrid items={items} storeUrl="https://shop.test" initialQuery="jazz" />)
    expect(setQuery).toHaveBeenCalledWith('jazz')
  })
})
