import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PurgeCustomerButton, { purgeCustomers, PURGE_WARNING } from '@controller/components/admin/ecom/PurgeCustomerButton'

// Confirm prompt, toast and router mocked so the type-to-confirm delete flow runs without providers.
// The prompt returns whatever `promptResult` is set to (the typed text, or null for cancel).
let promptResult: string | null = 'acme'
const prompt = vi.fn<(...a: any[]) => any>(() => Promise.resolve(promptResult))
const toastError = vi.fn<(...a: any[]) => any>()
const toastSuccess = vi.fn<(...a: any[]) => any>()
const push = vi.fn<(...a: any[]) => any>()
const refresh = vi.fn<(...a: any[]) => any>()

vi.mock('@/contexts/ConfirmContext', () => ({ usePrompt: () => prompt }))
vi.mock('@/components/admin/kit/toast', () => ({ useActionToast: () => ({ error: toastError, success: toastSuccess }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))

describe('purgeCustomers', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('POSTs per store and reports ok/error per result', async () => {
    const fetchMock = vi
      .fn<(...a: any[]) => any>()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ error: 'boom' }) })
    vi.stubGlobal('fetch', fetchMock)

    const res = await purgeCustomers([
      { id: 'a', slug: 'acme' },
      { id: 'b', slug: 'beta' },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(res[0]).toEqual({ id: 'a', slug: 'acme', ok: true })
    expect(res[1]).toEqual({ id: 'b', slug: 'beta', ok: false, error: 'boom' })
  })

  it('maps a thrown fetch to a network error result', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockRejectedValue(new Error('down')))
    const [r] = await purgeCustomers([{ id: 'a', slug: 'acme' }])
    expect(r).toEqual({ id: 'a', slug: 'acme', ok: false, error: 'Network error' })
  })
})

describe('PurgeCustomerButton', () => {
  beforeEach(() => {
    promptResult = 'acme'
    prompt.mockClear()
    toastError.mockClear()
    toastSuccess.mockClear()
    push.mockClear()
    refresh.mockClear()
  })

  it('renders the Delete button', () => {
    render(<PurgeCustomerButton tenantId="a" slug="acme" />)
    const btn = screen.getByRole('button', { name: /Delete/ })
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveAttribute('title', expect.stringContaining('Permanently delete'))
  })

  it('prompts with the slug confirmation, then deletes and navigates to afterHref', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }))
    render(<PurgeCustomerButton tenantId="a" slug="acme" afterHref="/admin/ecom/customers?tab=list" />)
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }))
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    expect(prompt.mock.calls[0][0]).toMatchObject({ placeholder: 'acme' })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Deleted acme'))
    expect(push).toHaveBeenCalledWith('/admin/ecom/customers?tab=list')
  })

  it('does nothing when the prompt is cancelled', async () => {
    promptResult = null
    const fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
    render(<PurgeCustomerButton tenantId="a" slug="acme" />)
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }))
    await waitFor(() => expect(prompt).toHaveBeenCalled())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('errors (no delete) when the typed slug does not match', async () => {
    promptResult = 'wrong'
    const fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
    render(<PurgeCustomerButton tenantId="a" slug="acme" />)
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('exposes the irreversible-warning copy', () => {
    expect(PURGE_WARNING).toMatch(/There is no restore/)
  })
})
