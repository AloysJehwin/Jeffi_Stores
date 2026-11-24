import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const loadStoreCronJobs = vi.fn<(...a: any[]) => any>()
vi.mock('@controller/lib/cron/store-jobs', () => ({ loadStoreCronJobs: (...a: any[]) => loadStoreCronJobs(...a) }))
vi.mock('@controller/components/admin/ecom/ProvisioningLogsClient', () => ({ default: ({ tenantId }: any) => <div data-testid="logs">logs:{tenantId}</div> }))
vi.mock('@controller/components/admin/ecom/detail/ScheduledJobs', () => ({ default: ({ jobs }: any) => <div data-testid="jobs">jobs:{jobs.length}</div> }))

import ProvisioningTab from '@controller/components/admin/ecom/tabs/ProvisioningTab'

const tenant = { id: 't9', slug: 'acme' } as any

describe('ProvisioningTab (server component)', () => {
  it('shows the run logs and the store cron jobs', async () => {
    loadStoreCronJobs.mockResolvedValue([{ name: 'a' }, { name: 'b' }])
    render(await ProvisioningTab({ tenant }))
    expect(loadStoreCronJobs).toHaveBeenCalledWith('t9', 'acme')
    expect(screen.getByTestId('logs')).toHaveTextContent('logs:t9')
    expect(screen.getByTestId('jobs')).toHaveTextContent('jobs:2')
  })

  it('falls back to no jobs when the cluster lookup fails', async () => {
    loadStoreCronJobs.mockRejectedValue(new Error('unreachable'))
    render(await ProvisioningTab({ tenant }))
    expect(screen.getByTestId('jobs')).toHaveTextContent('jobs:0')
    expect(screen.getByTestId('logs')).toBeInTheDocument()
  })
})
