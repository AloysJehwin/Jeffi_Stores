import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
let cfg: any
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => cfg }))

import CustomerChatModal from '@/components/visitor/CustomerChatModal'

const fetchMock = vi.fn()
const chatReply = (message: string) =>
  fetchMock.mockImplementation(async (url: string) =>
    url === '/api/customer-agent/chat' ? { ok: true, status: 200, json: async () => ({ message }) } : { ok: true, status: 200, json: async () => ({}) }
  )
const PLACEHOLDER = 'Ask about products or your orders…'

function setup(isOpen = true) {
  const onClose = vi.fn()
  const utils = render(<CustomerChatModal isOpen={isOpen} onClose={onClose} />)
  return { onClose, ...utils }
}
const ask = (text: string) => {
  fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

describe('CustomerChatModal', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    cfg = { flags: { aiStorefrontEnabled: true }, identity: { name: 'Halo' } }
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('renders nothing when the AI storefront flag is off', () => {
    cfg.flags.aiStorefrontEnabled = false
    const { container } = setup()
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the branded header, sample prompts and a disabled Send', () => {
    setup()
    expect(screen.getByText('Halo Assistant')).toBeInTheDocument()
    expect(screen.getByText('Try asking')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Help me find a gift' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    cfg.identity.name = ''
    setup()
    expect(screen.getByText('Shopping Assistant')).toBeInTheDocument()
  })

  it('closes from the X button and the backdrop', () => {
    const { onClose, container } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(container.querySelector('[aria-hidden="true"].fixed')!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('sends a typed message with empty history and shows the reply', async () => {
    chatReply('Try our new speaker.')
    setup()
    ask("  What's good?  ")
    expect(await screen.findByText('Try our new speaker.')).toBeInTheDocument()
    const call = fetchMock.mock.calls.find(c => c[0] === '/api/customer-agent/chat')!
    expect(JSON.parse(call[1].body)).toEqual({ message: "What's good?", history: [] })
    expect(screen.getByText("What's good?")).toBeInTheDocument()
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveValue('')
  })

  it('a sample prompt sends itself, and later turns carry the earlier ones as history', async () => {
    chatReply('First answer')
    setup()
    fireEvent.click(screen.getByRole('button', { name: "What's new this week?" }))
    await screen.findByText('First answer')
    chatReply('Second answer')
    ask('and cheaper?')
    await screen.findByText('Second answer')
    const calls = fetchMock.mock.calls.filter(c => c[0] === '/api/customer-agent/chat')
    expect(JSON.parse(calls[1][1].body).history).toEqual([
      { role: 'user', content: "What's new this week?" },
      { role: 'assistant', content: 'First answer' },
    ])
    expect(screen.queryByText('Try asking')).not.toBeInTheDocument()
  })

  it('Enter sends and Shift+Enter does not', async () => {
    chatReply('ok')
    setup()
    const box = screen.getByPlaceholderText(PLACEHOLDER)
    fireEvent.change(box, { target: { value: 'hello' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByText('ok')
  })

  it('renders product and order tokens as cards and hides price-list lines', async () => {
    chatReply(
      'Here are picks:[[product:halo-speaker|Halo Speaker|999]]1. - ₹999 Speaker[[order:1001|shipped|1,499.00|3 May]][[order:1002|granted|0|4 May]]'
    )
    const { onClose } = setup()
    ask('show me')
    const product = await screen.findByRole('link', { name: /Halo Speaker/ })
    expect(product).toHaveAttribute('href', '/products/halo-speaker')
    expect(screen.getByText('₹999')).toBeInTheDocument()
    expect(screen.getByText('#1001')).toBeInTheDocument()
    expect(screen.getByText('shipped')).toBeInTheDocument()
    expect(screen.getByText('Access granted')).toBeInTheDocument()
    expect(screen.getByText(/3 May · ₹1,499\.00/)).toBeInTheDocument()
    expect(screen.getByText('Here are picks:')).toBeInTheDocument()
    expect(screen.queryByText(/1\. - ₹999/)).not.toBeInTheDocument()
    fireEvent.click(product)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call the model for an empty message', () => {
    setup()
    fireEvent.submit(screen.getByPlaceholderText(PLACEHOLDER).closest('form')!)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows a typing indicator while waiting and locks the composer', async () => {
    let resolve!: (v: any) => void
    fetchMock.mockImplementation(() => new Promise(r => (resolve = r)))
    const { container } = setup()
    ask('hi')
    await waitFor(() => expect(container.querySelectorAll('.animate-bounce')).toHaveLength(3))
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeDisabled()
    resolve({ ok: true, status: 200, json: async () => ({ message: 'done' }) })
    await screen.findByText('done')
    expect(container.querySelectorAll('.animate-bounce')).toHaveLength(0)
  })

  it('403 says the assistant is unavailable', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) })
    setup()
    ask('hi')
    expect(await screen.findByText('The assistant is not available right now.')).toBeInTheDocument()
  })

  it('a server error never leaks its text; it shows a friendly line', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'stack trace here' }) })
    setup()
    ask('hi')
    expect(await screen.findByText(/having trouble responding/)).toBeInTheDocument()
    expect(screen.queryByText(/stack trace/)).not.toBeInTheDocument()
  })

  it('no model: an explicit notice, search results labelled as such, no assistant bubble or feedback', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) =>
      url === '/api/customer-agent/chat'
        ? {
            ok: false,
            status: 503,
            json: async () => ({
              unavailable: true,
              message: 'The assistant is unavailable right now. Please try again in a few minutes.',
              searchResults: [{ name: 'Halo Speaker', slug: 'halo-speaker', price: '4999' }],
            }),
            init,
          }
        : { ok: true, status: 200, json: async () => ({}) }
    )
    setup()
    ask('speaker')
    expect(await screen.findByRole('status')).toHaveTextContent('The assistant is unavailable right now.')
    expect(screen.getByText('Search results for “speaker”')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Halo Speaker/ })).toHaveAttribute('href', '/products/halo-speaker')
    expect(screen.queryByRole('button', { name: 'Helpful' })).not.toBeInTheDocument()

    fetchMock.mockClear()
    ask('again')
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.history).toEqual([{ role: 'user', content: 'speaker' }])
  })

  it('a network failure shows a retry message', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    setup()
    ask('hi')
    expect(await screen.findByText('Network error. Please try again.')).toBeInTheDocument()
  })

  it('feedback buttons post the verdict once and then lock', async () => {
    chatReply('answer')
    setup()
    ask('hi')
    await screen.findByText('answer')
    fireEvent.click(screen.getByRole('button', { name: 'Helpful' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[0] === '/api/ai-assistant/feedback')).toBe(true))
    const fb = fetchMock.mock.calls.find(c => c[0] === '/api/ai-assistant/feedback')!
    expect(JSON.parse(fb[1].body)).toEqual({ signal: 'helpful' })
    expect(screen.getByRole('button', { name: 'Helpful' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Not helpful' })).toBeDisabled()
  })

  it('clears the conversation when closed', async () => {
    chatReply('answer')
    const { rerender, onClose } = setup()
    ask('hi')
    await screen.findByText('answer')
    rerender(<CustomerChatModal isOpen={false} onClose={onClose} />)
    expect(screen.queryByText('answer')).not.toBeInTheDocument()
    rerender(<CustomerChatModal isOpen onClose={onClose} />)
    expect(screen.getByText('Try asking')).toBeInTheDocument()
  })
})
