import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProvisioningLogsClient from '@controller/components/admin/ecom/ProvisioningLogsClient'

// PipelineView lives in the pipeline/ subdir (owned elsewhere) and streams a live run; mock it so this
// thin wrapper is tested in isolation — it must forward tenantId.
vi.mock('@controller/components/admin/ecom/pipeline/PipelineView', () => ({
  PipelineView: ({ tenantId }: { tenantId: string }) => <div data-testid="pipeline">pipeline:{tenantId}</div>,
}))

describe('ProvisioningLogsClient', () => {
  it('renders PipelineView with the tenantId it was given', () => {
    render(<ProvisioningLogsClient tenantId="tnt_42" />)
    expect(screen.getByTestId('pipeline')).toHaveTextContent('pipeline:tnt_42')
  })
})
