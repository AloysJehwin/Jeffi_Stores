import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast }), useToast: () => ({ showToast }) }))
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))
vi.mock('@/components/ui/Select', () => ({
  MultiSelect: ({ options, onChange, value, placeholder }: any) => (
    <div>
      <span>{placeholder}</span>
      {options.map((o: any) => (
        <button key={o.value} type="button" onClick={() => onChange([...value, o.value])}>
          {o.label}
        </button>
      ))}
    </div>
  ),
}))

import ScopedPushPanel from '@/components/admin/channels/ScopedPushPanel'

const brands = { brands: [{ brandId: 'b1', brandName: 'Bosch', productCount: 12, allowed: true }] }
const categories = { categories: [{ id: 'c1', name: 'Tools', parent_category_id: null }, { id: 'c2', name: 'Drills', parent_category_id: 'c1' }] }
const ok = (data: unknown) => ({ ok: true, json: async () => data })

describe('ScopedPushPanel', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    canWrite = true
    fetchMock = vi.fn<(...a: any[]) => any>(async (url: string) => (url.includes('brand-approvals') ? ok(brands) : ok(categories)))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('renders nothing without write permission', () => {
    canWrite = false
    const { container } = render(<ScopedPushPanel channel="gmc" endpoint="/api/push" writeScope="gmc:write" />)
    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loads options and pushes the selected scope', async () => {
    const onPushed = vi.fn()
    render(<ScopedPushPanel channel="gmc" endpoint="/api/push" writeScope="gmc:write" onPushed={onPushed} />)
    expect(screen.getByText('Push by brand or category')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Push selected' })).toBeDisabled()
    fireEvent.click(await screen.findByRole('button', { name: 'Bosch (12)' }))
    expect(await screen.findByRole('button', { name: 'Tools › Drills' })).toBeInTheDocument()
    fetchMock.mockResolvedValueOnce(ok({ synced: 5, deleted: 1, skipped: 2 }))
    fireEvent.click(screen.getByRole('button', { name: 'Push selected' }))
    await waitFor(() => expect(onPushed).toHaveBeenCalled())
    const call = fetchMock.mock.calls.at(-1)!
    expect(call[0]).toBe('/api/push')
    expect(JSON.parse(call[1].body)).toEqual({ brandIds: ['b1'] })
    expect(showToast).toHaveBeenCalledWith('Pushed 5 items to Google.', 'success')
    expect(screen.getByText(/Pushed 5 item\(s\) to Google, removed 1/)).toBeInTheDocument()
    expect(screen.getByText(/Held back 2 product\(s\)/)).toBeInTheDocument()
  })

  it('warns when a sync is already running and errors on failure', async () => {
    const onRunning = vi.fn()
    render(<ScopedPushPanel channel="gmc" endpoint="/api/push" writeScope="gmc:write" onRunning={onRunning} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Bosch (12)' }))
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ inProgress: true, error: 'Busy' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Push selected' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Busy', 'warning'))
    expect(onRunning).toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Nope' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Push selected' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Nope', 'error'))
  })

  it('runs an Amazon dry run and lists blocked products', async () => {
    render(<ScopedPushPanel channel="amazon" endpoint="/api/push" writeScope="amazon:write" dryRun />)
    await screen.findByRole('button', { name: 'Bosch (12)' })
    fetchMock.mockResolvedValueOnce(
      ok({
        report: {
          scanned: 2, offerOnly: 1, create: 1, postable: 1, blocked: 1, truncated: false,
          rows: [
            { productId: 'p1', sku: 'OK1', name: 'Fine drill', brand: 'Bosch', strategy: 'offer-only', asin: 'B00', postable: true },
            { productId: 'p2', sku: 'BAD1', name: 'Bad drill', brand: 'Bosch', strategy: 'create', asin: null, postable: false, blockReason: 'No GTIN' },
          ],
        },
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dry run' }))
    expect(await screen.findByText('BAD1')).toBeInTheDocument()
    expect(screen.getByText('No GTIN')).toBeInTheDocument()
    expect(screen.queryByText('OK1')).not.toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toEqual({ mode: 'dryrun' })
    expect(showToast).toHaveBeenCalledWith('Dry run checked 2 products. Nothing was sent to Amazon.', 'success')
  })

  it('shows a load error and lets the selection be cleared', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('brand-approvals') ? { ok: false, json: async () => ({ error: 'No access' }) } : ok(categories)))
    render(<ScopedPushPanel channel="gmc" endpoint="/api/push" writeScope="gmc:write" />)
    expect(await screen.findByText('No access')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Tools' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByRole('button', { name: 'Push selected' })).toBeDisabled()
  })
})
