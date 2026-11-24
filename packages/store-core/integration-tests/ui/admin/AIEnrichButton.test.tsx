import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let aiAllowed = true
vi.mock('@/contexts/AdminScopesContext', () => ({ RequireAi: ({ children }: any) => (aiAllowed ? <>{children}</> : null) }))

import AIEnrichButton, { ECOM_ENRICH_ENDPOINT } from '@/components/admin/AIEnrichButton'

const fetchMock = vi.fn()
beforeEach(() => {
  aiAllowed = true
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const ok = (result: string) => fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ result }) })

describe('AIEnrichButton (corner)', () => {
  it('wraps the field and offers Enrich when it has text', () => {
    render(
      <AIEnrichButton fieldLabel="Title" value="Cotton shirt" onChange={() => {}} scope="products">
        <input aria-label="title" />
      </AIEnrichButton>
    )
    expect(screen.getByLabelText('title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI enrich' })).toHaveAttribute('title', 'Enrich with AI')
    expect(screen.getByRole('button', { name: 'AI enrich' })).toBeEnabled()
  })

  it('is disabled for an empty field unless it may write from scratch', () => {
    const { rerender } = render(<AIEnrichButton fieldLabel="Title" value="  " onChange={() => {}} scope="products" />)
    expect(screen.getByRole('button', { name: 'AI enrich' })).toBeDisabled()
    rerender(<AIEnrichButton fieldLabel="Title" value="" write onChange={() => {}} scope="products" />)
    expect(screen.getByRole('button', { name: 'AI enrich' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'AI enrich' })).toHaveAttribute('title', 'Write with AI')
  })

  it('is hidden when the admin may not use AI', () => {
    aiAllowed = false
    render(<AIEnrichButton fieldLabel="Title" value="x" onChange={() => {}} scope="products"><input aria-label="t" /></AIEnrichButton>)
    expect(screen.queryByRole('button', { name: 'AI enrich' })).toBeNull()
    expect(screen.getByLabelText('t')).toBeInTheDocument()
  })

  it('posts the field, applies the result and offers Undo that restores the original', async () => {
    ok('A better title')
    const onChange = vi.fn()
    render(<AIEnrichButton fieldLabel="Title" value="Cotton shirt" onChange={onChange} scope="products" context="Men" format={'plain' as any} maxLength={60} variables={['name']} broadcast />)
    fireEvent.click(screen.getByRole('button', { name: 'AI enrich' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('A better title'))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/ai-enrich-field')
    expect(JSON.parse(init.body)).toMatchObject({ fieldLabel: 'Title', value: 'Cotton shirt', context: 'Men', scope: 'products', maxLength: 60, variables: ['name'], broadcast: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Undo AI enrichment' }))
    expect(onChange).toHaveBeenLastCalledWith('Cotton shirt')
    expect(screen.queryByRole('button', { name: 'Undo AI enrichment' })).toBeNull()
  })

  it('uses a custom endpoint and shows the error from the server', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Quota used up' }) })
    render(<AIEnrichButton fieldLabel="Title" value="x" onChange={() => {}} scope="products" endpoint={ECOM_ENRICH_ENDPOINT} />)
    fireEvent.click(screen.getByRole('button', { name: 'AI enrich' }))
    expect(await screen.findByText('Quota used up')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe(ECOM_ENRICH_ENDPOINT)
  })

  it('falls back to a generic message when the call has no result or the network fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
    render(<AIEnrichButton fieldLabel="Title" value="x" onChange={() => {}} scope="products" />)
    fireEvent.click(screen.getByRole('button', { name: 'AI enrich' }))
    expect(await screen.findByText('Enrichment failed')).toBeInTheDocument()
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'AI enrich' }))
    expect(await screen.findByText('Network error')).toBeInTheDocument()
  })

  it('does not call the API for an empty field', () => {
    render(<AIEnrichButton fieldLabel="Title" value="" onChange={() => {}} scope="products" />)
    fireEvent.click(screen.getByRole('button', { name: 'AI enrich' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('disables the button while the external busy flag is set', () => {
    render(<AIEnrichButton fieldLabel="Title" value="x" onChange={() => {}} scope="products" aiBusy />)
    expect(screen.getByRole('button', { name: 'AI enrich' })).toBeDisabled()
  })
})

describe('AIEnrichButton (aiFill)', () => {
  it('calls the caller handler instead of the endpoint, even for an empty field', async () => {
    const aiFill = vi.fn().mockResolvedValue(undefined)
    render(<AIEnrichButton fieldLabel="Title" value="" onChange={() => {}} scope="products" aiFill={aiFill} />)
    fireEvent.click(screen.getByRole('button', { name: 'AI enrich' }))
    await waitFor(() => expect(aiFill).toHaveBeenCalledTimes(1))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Undo AI enrichment' })).toBeNull()
  })

  it('shows an error when the handler throws', async () => {
    render(<AIEnrichButton fieldLabel="Title" value="x" onChange={() => {}} scope="products" aiFill={() => Promise.reject(new Error('x'))} />)
    fireEvent.click(screen.getByRole('button', { name: 'AI enrich' }))
    expect(await screen.findByText('AI call failed')).toBeInTheDocument()
  })
})

describe('AIEnrichButton placements', () => {
  it('in-field renders only the sparkle with the anchor class', () => {
    const { container } = render(<AIEnrichButton fieldLabel="T" value="x" onChange={() => {}} scope="products" placement="in-field" anchorClassName="absolute left-1 top-1" />)
    expect(container.firstElementChild).toHaveClass('absolute', 'left-1', 'top-1')
    expect(screen.getByRole('button', { name: 'AI enrich' })).toBeInTheDocument()
  })

  it('inline renders a sibling row and shows its error beneath', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Nope' }) })
    render(<AIEnrichButton fieldLabel="T" value="x" onChange={() => {}} scope="products" placement="inline" />)
    fireEvent.click(screen.getByRole('button', { name: 'AI enrich' }))
    expect(await screen.findByText('Nope')).toBeInTheDocument()
  })

  it('multiline fields put the sparkle at the bottom right', () => {
    const { container } = render(<AIEnrichButton fieldLabel="T" value="x" onChange={() => {}} scope="products" multiline><textarea aria-label="d" /></AIEnrichButton>)
    expect(container.querySelector('.bottom-2.right-2')).not.toBeNull()
  })
})
