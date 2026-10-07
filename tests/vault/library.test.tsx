import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  usePathname: () => '/library',
  useRouter: () => ({ push: vi.fn() }),
}))

import { filterLibrary, primaryKind, countByKind, accessLabel, type LibraryItem } from '@/lib/vault/library-filter'
import VaultShell from '@/components/vault/VaultShell'
import LibraryGrid from '@/components/vault/LibraryGrid'

const item = (over: Partial<LibraryItem>): LibraryItem => ({
  product_id: Math.random().toString(36).slice(2),
  title: 'Untitled',
  cover_url: null,
  source: 'one_time',
  access_expires_at: null,
  kinds: [],
  file_count: 1,
  ...over,
})

const items = [
  item({ product_id: 'v', title: 'Woodworking Masterclass', kinds: ['video', 'pdf'], file_count: 3 }),
  item({ product_id: 'a', title: 'Shop Talk Podcast', kinds: ['audio'], source: 'subscription', access_expires_at: '2099-01-01T00:00:00Z' }),
  item({ product_id: 'p', title: 'Joinery Handbook', kinds: ['pdf'] }),
  item({ product_id: 'o', title: 'CAD Templates', kinds: ['other', 'image'] }),
]

describe('library-filter', () => {
  it('derives one headline kind: video > audio > pdf > other', () => {
    expect(primaryKind(['pdf', 'video'])).toBe('video')
    expect(primaryKind(['audio', 'pdf'])).toBe('audio')
    expect(primaryKind(['pdf', 'image'])).toBe('pdf')
    expect(primaryKind(['image'])).toBe('other')
    expect(primaryKind(null)).toBe('other')
  })

  it('filters by kind and multi-term, case-insensitive title search', () => {
    expect(filterLibrary(items, { kind: 'pdf' }).map(i => i.product_id)).toEqual(['p'])
    expect(filterLibrary(items, { query: '  JOIN hand ' }).map(i => i.product_id)).toEqual(['p'])
    expect(filterLibrary(items, { kind: 'video', query: 'join' })).toEqual([])
    expect(filterLibrary(items, {}).length).toBe(4)
  })

  it('counts per kind and labels access', () => {
    expect(countByKind(items)).toEqual({ all: 4, video: 1, audio: 1, pdf: 1, other: 1 })
    expect(accessLabel(null)).toBe('Lifetime access')
    expect(accessLabel('2000-01-01T00:00:00Z')).toBe('Access expired')
    expect(accessLabel('2099-01-01T00:00:00Z')).toMatch(/^Access until /)
  })
})

function mountGrid(list: LibraryItem[], initialQuery = '') {
  return render(
    <VaultShell storeName="Acme" logoUrl={null} storeUrl="https://acme.example" buyer={{ name: 'Ann', email: 'ann@example.com' }}>
      <LibraryGrid items={list} storeUrl="https://acme.example" initialQuery={initialQuery} />
    </VaultShell>
  )
}

const titles = () => screen.queryAllByRole('listitem').map(li => li.textContent)

describe('LibraryGrid', () => {
  it('shows the empty state with a link back to the store', () => {
    mountGrid([])
    expect(screen.getByText('No purchases yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Browse the store/ }).getAttribute('href')).toBe('https://acme.example')
  })

  it('filters with type chips and the shell search box, and shows a no-results state', () => {
    mountGrid(items)
    expect(screen.getByText('4 items')).toBeTruthy()
    expect(titles().length).toBe(4)

    fireEvent.click(screen.getByRole('tab', { name: /Books & PDFs/ }))
    expect(titles()).toHaveLength(1)
    expect(titles()[0]).toMatch(/Joinery Handbook/)

    fireEvent.click(screen.getByRole('tab', { name: /All/ }))
    const search = screen.getAllByRole('searchbox', { name: 'Search your library' })[0]
    fireEvent.change(search, { target: { value: 'podcast' } })
    expect(titles()).toHaveLength(1)
    const card = screen.getAllByRole('listitem')[0]
    expect(within(card).getByText('Subscription')).toBeTruthy()
    expect(within(card).getByText(/Access until/)).toBeTruthy()

    fireEvent.change(search, { target: { value: 'nothing-matches' } })
    expect(screen.getByText('No matches')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(titles()).toHaveLength(4)
  })

  it('applies a ?q= carried from another vault page and links cards to the item page', () => {
    mountGrid(items, 'masterclass')
    expect(titles()).toHaveLength(1)
    expect(screen.getByRole('link', { name: /Woodworking Masterclass/ }).getAttribute('href')).toBe('/item/v')
    expect(screen.getByText(/Lifetime access/)).toBeTruthy()
  })
})

describe('VaultShell account menu', () => {
  it('shows buyer identity, store links, and signs out via the vault logout endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, redirect: 'https://acme.example' })))
    vi.stubGlobal('fetch', fetchMock)
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign } as any)

    mountGrid(items)
    expect(screen.getByRole('link', { name: /Library/ }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getAllByText('ann@example.com').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('menuitem', { name: /Back to store/ })[0].getAttribute('href')).toBe('https://acme.example')
    expect(screen.getAllByRole('menuitem', { name: /My orders/ })[0].getAttribute('href')).toBe('https://acme.example/account/orders')

    fireEvent.click(screen.getAllByRole('menuitem', { name: /Sign out/ })[0])
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://acme.example'))
    expect(fetchMock).toHaveBeenCalledWith('/api/vault/logout', expect.objectContaining({ method: 'POST' }))
    vi.unstubAllGlobals()
  })
})
