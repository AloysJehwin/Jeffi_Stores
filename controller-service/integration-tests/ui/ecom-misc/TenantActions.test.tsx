import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TenantActions from '@controller/components/admin/ecom/TenantActions'

// Router + toast mocked. ActionButton is stubbed to a plain button that renders its label and fires
// onClick (we assert WHICH actions appear per status and that they POST the right endpoint).
// DeprovisionDialog is stubbed to a trigger that calls onConfirm so the deprovision path is exercised
// without the real dialog's radios (covered in DeprovisionDialog.test.tsx).
const push = vi.fn<(...a: any[]) => any>()
const refresh = vi.fn<(...a: any[]) => any>()
const toastSuccess = vi.fn<(...a: any[]) => any>()
const toastError = vi.fn<(...a: any[]) => any>()

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))
vi.mock('@/components/admin/kit', () => ({
  useActionToast: () => ({ success: toastSuccess, error: toastError }),
  ActionButton: ({ action }: { action: { label: string; onClick?: () => void } }) => (
    <button onClick={() => action.onClick?.()}>{action.label}</button>
  ),
}))
vi.mock('@controller/components/admin/ecom/DeprovisionDialog', () => ({
  default: ({ open, onConfirm }: { open: boolean; onConfirm: (keep: any) => Promise<void> }) =>
    open ? (
      <button onClick={() => onConfirm({ database: false, media: false, config: false })}>confirm-deprovision</button>
    ) : null,
}))

const base = (over: Partial<React.ComponentProps<typeof TenantActions>> = {}): React.ComponentProps<typeof TenantActions> => ({
  tenantId: 't1',
  slug: 'acme',
  status: 'active',
  instanceState: 'running',
  jobStatus: null,
  jobStep: null,
  rolledBack: false,
  retentionDays: 30,
  ...over,
})

describe('TenantActions', () => {
  beforeEach(() => {
    push.mockClear()
    refresh.mockClear()
    toastSuccess.mockClear()
    toastError.mockClear()
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }))
  })

  it('an active store shows a Deprovision action but no Provision', () => {
    render(<TenantActions {...base({ status: 'active' })} />)
    expect(screen.getByRole('button', { name: 'Deprovision' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Provision/ })).not.toBeInTheDocument()
  })

  it('a provisioning tenant with no job offers Provision infrastructure', () => {
    render(<TenantActions {...base({ status: 'provisioning' })} />)
    expect(screen.getByRole('button', { name: 'Provision infrastructure' })).toBeInTheDocument()
  })

  it('a failed job (not rolled back) offers Retry from the last step', () => {
    render(<TenantActions {...base({ status: 'provisioning', jobStatus: 'failed', jobStep: 'rds', rolledBack: false })} />)
    expect(screen.getByRole('button', { name: /Retry from rds/ })).toBeInTheDocument()
  })

  it('a run in flight shows the Provisioning pill with the step and hides Provision', () => {
    render(<TenantActions {...base({ status: 'provisioning', jobStatus: 'running', jobStep: 'dns' })} />)
    expect(screen.getByText(/Provisioning: dns/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Provision infrastructure' })).not.toBeInTheDocument()
  })

  it('a test tenant that is active can disable its instance', () => {
    render(<TenantActions {...base({ slug: 'test', status: 'active', instanceState: 'running' })} />)
    expect(screen.getByRole('button', { name: 'Disable instance' })).toBeInTheDocument()
  })

  it('a stopped test instance shows Enable and the powered-down note', () => {
    render(<TenantActions {...base({ slug: 'test', status: 'active', instanceState: 'stopped' })} />)
    expect(screen.getByRole('button', { name: 'Enable instance' })).toBeInTheDocument()
    expect(screen.getByText(/DB powered down/)).toBeInTheDocument()
  })

  it('clicking Deprovision opens the dialog and confirming POSTs the deprovision endpoint', async () => {
    const fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', fetchMock)
    render(<TenantActions {...base({ status: 'active' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Deprovision' }))
    fireEvent.click(screen.getByRole('button', { name: 'confirm-deprovision' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/ecom/customers/t1/deprovision')
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Done'))
  })

  it('a terminated store shows no operator actions', () => {
    render(<TenantActions {...base({ status: 'terminated' })} />)
    expect(screen.queryByRole('button', { name: 'Deprovision' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Provision/ })).not.toBeInTheDocument()
  })
})
