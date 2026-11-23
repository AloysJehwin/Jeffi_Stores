import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// DeliveryEstimateCard: loads EDD settings on mount (GET /api/admin/edd-settings), then renders the day
// fields, warehouse select, metro box and a debounced live preview. fetch is mocked per endpoint.

const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
  useToastOptional: () => ({ showToast }),
}))

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import DeliveryEstimateCard from '@/components/admin/site-controls/DeliveryEstimateCard'

const settings = {
  handlingDays: 1,
  sameCityDays: 2,
  sameRegionDays: 3,
  metroDays: 4,
  restDays: 5,
  remoteDays: 7,
  skipSundays: true,
  metroPrefixes: ['110', '560'],
}

const loadBody = {
  settings,
  defaults: { ...settings, handlingDays: 2 },
  warehouses: [{ name: 'Main', pin: '560001', city: 'Blr', state: 'KA' }],
  defaultWarehouse: 'Main',
}

// Resolve GET load; everything else (PUT/preview) is a generic ok.
function routedFetch() {
  return vi.fn<(...a: any[]) => any>().mockImplementation((url: string, init?: any) => {
    if (url === '/api/admin/edd-settings' && (!init || init.method === undefined)) {
      return Promise.resolve({ ok: true, json: async () => loadBody })
    }
    if (url.includes('/preview')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ zoneLabel: 'Metro', state: 'KA', originPin: '560001', handlingDays: 1, transitDays: 3, totalDays: 4, edd: '2026-12-01' }),
      })
    }
    return Promise.resolve({ ok: true, json: async () => ({ settings }) })
  })
}

describe('DeliveryEstimateCard', () => {
  beforeEach(() => {
    showToast.mockReset()
    canWrite = true
  })

  it('shows a load error when the settings cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: false, json: async () => ({}) }))
    render(<DeliveryEstimateCard />)
    await waitFor(() => expect(screen.getByText('Failed to load')).toBeInTheDocument())
  })

  it('renders the day fields and metro box once settings load', async () => {
    vi.stubGlobal('fetch', routedFetch())
    render(<DeliveryEstimateCard />)
    await waitFor(() => expect(screen.getByText('Handling / dispatch')).toBeInTheDocument())
    expect(screen.getByText('Same city')).toBeInTheDocument()
    expect(screen.getByText('Rest of India')).toBeInTheDocument()
    // Metro prefixes joined back into the textarea.
    expect(screen.getByDisplayValue('110, 560')).toBeInTheDocument()
    // Skip Sundays switch reflects the loaded value.
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('saves via PUT and toasts Saved', async () => {
    const fetchMock = routedFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<DeliveryEstimateCard />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(c => c[1]?.method === 'PUT')
      expect(put).toBeTruthy()
    })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Saved', 'success'))
  })

  it('hides the Save/Reset actions when the admin cannot write', async () => {
    canWrite = false
    vi.stubGlobal('fetch', routedFetch())
    render(<DeliveryEstimateCard />)
    await waitFor(() => expect(screen.getByText('Handling / dispatch')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset to defaults' })).not.toBeInTheDocument()
  })
})
