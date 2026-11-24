import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent, waitFor, act } from '@testing-library/react'
import AiSiteBuilder from '@/components/admin/site-builder/AiSiteBuilder'
import { UI_STYLES } from '@/lib/site/studio/ui-styles'
import { renderAs, res, routeFetch, bodyOf, callsTo } from '../admin-marketplace/marketplace-kit'

// AiSiteBuilder: "Redesign my whole site with AI". Loads the overview (availability, price quote, the current
// design, any build in flight), starts a build, polls its progress and offers the resulting draft.
const SITE_AI = '/api/admin/site-builder/ai/site'
const colours = { primary: '#111111', accent: '#222222', neutral: '#333333' }
const freeQuote = { free: true, capInr: 0, range: { lowInr: 0, highInr: 0 }, balanceInr: 0, shortInr: 0 }
const overview = (over: Record<string, unknown> = {}) => ({ available: true, quote: freeQuote, current: { name: 'Midnight', uiStyle: null, studio: false, colours }, active: null, ...over })
const pages = [
  { key: 'home', label: 'Home', status: 'done' },
  { key: 'cart', label: 'Cart', status: 'failed' },
  { key: 'checkout', label: 'Checkout', status: 'waiting' },
]

function setup(who: 'writer' | 'reader' = 'writer') {
  const onOpen = vi.fn()
  const utils = renderAs(<AiSiteBuilder onOpen={onOpen} />, who)
  return { onOpen, ...utils }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AiSiteBuilder', () => {
  it('shows the design and colour choices, with the free-generation note', async () => {
    routeFetch([[SITE_AI, res(overview())]])
    setup()
    expect(await screen.findByText('Free: your store’s first full AI generation.')).toBeInTheDocument()
    expect(screen.getByText('Redesign my whole site with AI')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Keep my design/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /Keep my colours/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Redesign my site' })).toBeEnabled()
  })

  it('renders nothing for an admin without write access', () => {
    routeFetch([[SITE_AI, res(overview())]])
    const { container } = setup('reader')
    expect(container).toBeEmptyDOMElement()
  })

  it('says generation is unavailable and rechecks on demand', async () => {
    const f = routeFetch([[SITE_AI, res(overview({ available: false }))]])
    setup()
    expect(await screen.findByText(/AI site generation isn’t available right now/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Redesign my site' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(callsTo(f, 'fresh=1')).toHaveLength(1))
  })

  it('shows the price range and blocks the build when the wallet is short', async () => {
    routeFetch([[SITE_AI, res(overview({ quote: { free: false, capInr: 60, range: { lowInr: 30, highInr: 50 }, balanceInr: 10, shortInr: 50 } }))]])
    setup()
    expect(await screen.findByText(/About ₹30–₹50 from your AI wallet, at most ₹60/)).toBeInTheDocument()
    expect(screen.getByText(/Add ₹50.00 to your AI wallet to start/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Top up' })).toHaveAttribute('href', expect.stringContaining('/admin/wallet'))
    expect(screen.getByRole('button', { name: 'Redesign my site' })).toBeDisabled()
  })

  it('asks for a reference site once a style is chosen, and starts the build', async () => {
    const f = routeFetch([[SITE_AI, (_u: string, init?: RequestInit) => (init?.method === 'POST' ? res({ draftId: 'd1' }) : res(overview()))]])
    setup()
    await screen.findByText('Redesign my whole site with AI')
    expect(screen.queryByPlaceholderText('https://')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(UI_STYLES[0].name) }))
    fireEvent.change(screen.getByPlaceholderText('https://'), { target: { value: ' https://example.com ' } })
    fireEvent.click(screen.getByRole('radio', { name: /New colours|From the site I like/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Redesign my site' }))
    expect(await screen.findByText(/Reading your store/)).toBeInTheDocument()
    expect(bodyOf(f, SITE_AI, 1)).toEqual({ design: UI_STYLES[0].id, reference: 'https://example.com', colours: 'new', expect: 'free' })
  })

  it('shows why a build could not start', async () => {
    routeFetch([[SITE_AI, (_u: string, init?: RequestInit) => (init?.method === 'POST' ? res({ error: 'Try later' }, false) : res(overview()))]])
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Redesign my site' }))
    expect(await screen.findByText('Try later')).toBeInTheDocument()
  })

  it('switches to the unavailable notice when starting reports ai_unavailable', async () => {
    routeFetch([[SITE_AI, (_u: string, init?: RequestInit) => (init?.method === 'POST' ? res({ code: 'ai_unavailable', error: 'Claude is down' }, false) : res(overview()))]])
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Redesign my site' }))
    expect(await screen.findByText(/AI site generation isn’t available right now/)).toBeInTheDocument()
  })

  it('updates the quote when the wallet turns out to be low', async () => {
    routeFetch([[SITE_AI, (_u: string, init?: RequestInit) => (init?.method === 'POST' ? res({ code: 'wallet_low', balanceInr: 5, neededInr: 40 }, false) : res(overview({ quote: { ...freeQuote, free: true } })))]])
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Redesign my site' }))
    expect(await screen.findByText(/Add ₹40.00 to your AI wallet/)).toBeInTheDocument()
  })

  it('picks up a running build on load and shows its page progress', async () => {
    routeFetch([[SITE_AI, res(overview({ active: { draftId: 'd1', ai: { status: 'running', step: 'Writing pages', style: 'Luxury', pages: [{ key: 'home', label: 'Home', status: 'building', sections: 4, written: 2 }, { key: 'cart', label: 'Cart', status: 'waiting' }] } } }))]])
    setup()
    expect(await screen.findByText('Writing pages · Luxury')).toBeInTheDocument()
    expect(screen.getByText('0 of 2 pages')).toBeInTheDocument()
    expect(screen.getByText('2/4')).toBeInTheDocument()
  })

  it('polls a running build until it finishes, then offers the draft', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let polls = 0
    routeFetch([
      [
        SITE_AI,
        (url: string) => {
          if (url.includes('draft=d1')) {
            polls++
            return res({ ai: { status: 'done', style: 'Luxury', pages: [{ key: 'home', label: 'Home', status: 'done' }], charge: { free: true } } })
          }
          return res(overview({ active: { draftId: 'd1', ai: { status: 'running', step: 'Writing pages', pages: [{ key: 'home', label: 'Home', status: 'building' }] } } }))
        },
      ],
    ])
    const { onOpen } = setup()
    await screen.findByText(/Writing pages/)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100)
    })
    expect(await screen.findByText(/Your Luxury redesign is ready: 1 of 1 pages designed/)).toBeInTheDocument()
    expect(screen.getByText('Free: your store’s first full AI generation.')).toBeInTheDocument()
    expect(polls).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Open the draft' }))
    expect(onOpen).toHaveBeenCalledWith('d1')
  })

  it('reports a stopped build, resumes the remaining pages and can start over', async () => {
    const f = routeFetch([
      [
        SITE_AI,
        (_u: string, init?: RequestInit) =>
          init?.method === 'POST'
            ? res({ draftId: 'd1' })
            : res(overview({ active: { draftId: 'd1', ai: { status: 'stopped', pages, resumable: true, resumeFree: true } } })),
      ],
    ])
    setup()
    expect(await screen.findByText('The build stopped before it finished. 1 of 3 pages are in the draft.')).toBeInTheDocument()
    expect(screen.getByText(/Not designed: Cart/)).toBeInTheDocument()
    expect(screen.getByText(/Carrying on is free/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Design the 2 remaining pages' }))
    expect(await screen.findByText(/Carrying on with the remaining pages/)).toBeInTheDocument()
    expect(bodyOf(f, SITE_AI, 1)).toMatchObject({ resume: 'd1', expect: 'free' })
  })

  it('shows a failed build’s error and Start a new redesign returns to the form', async () => {
    routeFetch([[SITE_AI, res(overview({ active: { draftId: 'd1', ai: { status: 'failed', error: 'The AI ran out of time', pages: [] } } }))]])
    setup()
    expect(await screen.findByText('The AI ran out of time')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start a new redesign' }))
    expect(screen.getByRole('button', { name: 'Redesign my site' })).toBeInTheDocument()
  })
})
