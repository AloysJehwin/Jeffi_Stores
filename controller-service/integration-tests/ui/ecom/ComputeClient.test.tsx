import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const refresh = vi.fn<(...a: any[]) => any>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const bigger = (spec: any) => ({ ...spec, services: { ...spec.services, storefront: { ...spec.services.storefront, size: 'L' } } })
vi.mock('@controller/app/(ecom)/ecom/_compute/ComputeConfigurator', () => ({
  ComputeConfigurator: (p: any) => (
    <div data-testid="configurator">
      <button type="button" onClick={() => p.onChange({ spec: bigger(p.current), valid: true })}>
        Pick bigger servers
      </button>
      <button type="button" onClick={() => p.onChange({ spec: bigger(p.current), valid: false })}>
        Pick invalid servers
      </button>
      <button type="button" onClick={() => p.onPlanChange('pro')}>
        Pick Pro plan
      </button>
    </div>
  ),
}))

import { presetSpec } from '@/lib/compute/presets'
import ComputeClient from '@controller/app/(ecom)/ecom/dashboard/compute/ComputeClient'

const original = window.location
afterEach(() => {
  Object.defineProperty(window, 'location', { value: original, writable: true })
})

const props = (over: Record<string, unknown> = {}) =>
  ({
    tenantId: 't1',
    planSlug: 'basic',
    billingInterval: 'monthly',
    current: presetSpec('basic'),
    change: null,
    priceInrMonth: 1180,
    paymentRequired: true,
    paused: false,
    plans: [{ slug: 'basic', name: 'Basic' }, { slug: 'pro', name: 'Pro' }],
    featureMatrix: { basic: ['store'], pro: ['store', 'forms'] },
    comparisonRows: [{ group: 'Apps', label: 'Forms builder', scopeKey: 'forms' }, { group: 'Apps', label: 'Store', scopeKey: 'store' }],
    ...over,
  }) as any

describe('ComputeClient', () => {
  it('shows what is running now: plan, billing and the monthly cost with GST', () => {
    render(<ComputeClient {...props()} />)
    expect(screen.getByText('Running now')).toBeInTheDocument()
    expect(screen.getByText('Basic', { selector: 'span, div' })).toBeInTheDocument()
    expect(screen.getByText('₹1,180/month incl. GST')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply change' })).toBeDisabled()
  })

  it('adds the yearly cost for yearly billing', () => {
    render(<ComputeClient {...props({ billingInterval: 'yearly' })} />)
    expect(screen.getByText('₹1,180/month incl. GST (₹11,800/year)')).toBeInTheDocument()
  })

  it('shows a failed change with its error', () => {
    render(<ComputeClient {...props({ change: { desired: presetSpec('basic'), status: 'failed', error: 'quota exceeded', applyMode: 'window' } })} />)
    expect(screen.getByText(/Could not be applied/)).toHaveTextContent('(quota exceeded)')
  })

  it('locks the form while the store is paused or a change is applying', () => {
    const { unmount } = render(<ComputeClient {...props({ paused: true })} />)
    expect(screen.getByText(/Your store is paused/)).toBeInTheDocument()
    expect(screen.queryByTestId('configurator')).toBeNull()
    unmount()
    render(<ComputeClient {...props({ change: { desired: presetSpec('basic'), status: 'applying', error: null, applyMode: 'window' } })} />)
    expect(screen.getByText(/A change is being applied/)).toBeInTheDocument()
  })

  it('previews a server resize and applies it as a compute change', async () => {
    const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', f)
    render(<ComputeClient {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick bigger servers' }))
    expect(screen.getByText('What changes')).toBeInTheDocument()
    expect(screen.getByText(/Services restart one copy at a time/)).toBeInTheDocument()
    expect(screen.getByText(/Plan changes are billed on your subscription/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }))
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled())
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/ecom/compute')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toMatchObject({ tenantId: 't1', applyMode: 'window' })
  })

  it('keeps Apply disabled when the chosen servers are invalid', () => {
    render(<ComputeClient {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick invalid servers' }))
    expect(screen.getByRole('button', { name: 'Apply change' })).toBeDisabled()
  })

  it('shows gained features and the plan arrow on a plan change, and applies through the plan endpoint', async () => {
    const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', f)
    render(<ComputeClient {...props({ paymentRequired: false })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick bigger servers' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick Pro plan' }))
    expect(screen.getByText('Gained')).toBeInTheDocument()
    expect(screen.getByText('Forms builder')).toBeInTheDocument()
    expect(screen.getByText(/Plan changes apply now/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }))
    await vi.waitFor(() => expect(f).toHaveBeenCalled())
    expect(f.mock.calls[0][0]).toBe('/api/ecom/plan')
    expect(f.mock.calls[0][1].method).toBe('POST')
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({ planSlug: 'pro', billingInterval: 'monthly' })
  })

  it('switching to yearly billing shows the billing arrow and goes through the plan endpoint', async () => {
    const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', f)
    render(<ComputeClient {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick bigger servers' }))
    fireEvent.click(screen.getByRole('tab', { name: /Yearly/ }))
    expect(screen.getByText(/Billing:/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }))
    await vi.waitFor(() => expect(f).toHaveBeenCalled())
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({ billingInterval: 'yearly' })
  })

  it('sends the owner to the checkout when the plan change returns one', async () => {
    const loc = { href: '' }
    Object.defineProperty(window, 'location', { value: loc, writable: true })
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({ checkoutUrl: 'https://rzp.io/upgrade' }) }))
    render(<ComputeClient {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick bigger servers' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick Pro plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }))
    await vi.waitFor(() => expect(loc.href).toBe('https://rzp.io/upgrade'))
    expect(refresh).not.toHaveBeenCalled()
  })

  it('shows the API error when the change cannot be saved', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: false, json: async () => ({ error: 'Plan locked' }) }))
    render(<ComputeClient {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick bigger servers' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }))
    expect(await screen.findByText('Plan locked')).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })
})
