import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const flags: Record<string, boolean> = {
  ondeviceSummaryEnabled: true,
  ondeviceFinetuneEnabled: false,
  ondeviceSummaryDesktopEnabled: true,
  ondeviceSummaryMobileEnabled: false,
  ondeviceFinetuneDesktopEnabled: false,
  ondeviceFinetuneMobileEnabled: false,
}
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags }) }))
const detect = vi.fn<(...a: any[]) => any>()
vi.mock('@/lib/on-device/capability', () => ({ detectOnDeviceCapability: () => detect() }))

import OnDeviceCapabilityDebug, { OnDeviceCapabilitySkeleton } from '@/components/on-device/OnDeviceCapabilityDebug'

const row = (label: string) => screen.getByText(label).nextElementSibling as HTMLElement

describe('OnDeviceCapabilityDebug', () => {
  it('shows a busy skeleton with the row labels while the device check runs', () => {
    detect.mockReturnValue(new Promise(() => {}))
    const { container } = render(<OnDeviceCapabilityDebug />)
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(screen.getByText('WebGPU')).toBeInTheDocument()
  })

  it('reports a capable desktop with flags and GPU details', async () => {
    detect.mockResolvedValue({
      capable: true,
      reason: 'ok',
      details: {
        isMobile: false,
        hasWebGPU: true,
        hasAdapter: true,
        gpuVendor: 'apple',
        deviceMemoryGB: 8,
        maxBufferSizeMB: 4096,
        maxStorageBufferBindingSizeMB: 2048,
        storageQuotaMB: 50000,
        modelCached: true,
      },
    })
    render(<OnDeviceCapabilityDebug />)
    expect(await screen.findByText('CAPABLE')).toBeInTheDocument()
    expect(row('reason')).toHaveTextContent('ok')
    expect(row('this device')).toHaveTextContent('desktop')
    expect(row('summary flag')).toHaveTextContent('enabled')
    expect(row('fine-tune flag')).toHaveTextContent('disabled')
    expect(row('summary · desktop')).toHaveTextContent('on')
    expect(row('summary · mobile')).toHaveTextContent('off')
    expect(row('GPU vendor')).toHaveTextContent('apple')
    expect(row('device memory')).toHaveTextContent('8 GB')
    expect(row('max buffer')).toHaveTextContent('4096 MB')
    expect(row('model cached')).toHaveTextContent('yes')
  })

  it('reports an incapable mobile with placeholders for unknown values', async () => {
    detect.mockResolvedValue({
      capable: false,
      reason: 'no-webgpu',
      details: {
        isMobile: true,
        hasWebGPU: false,
        hasAdapter: false,
        gpuVendor: null,
        deviceMemoryGB: null,
        maxBufferSizeMB: null,
        maxStorageBufferBindingSizeMB: null,
        storageQuotaMB: null,
        modelCached: false,
      },
    })
    render(<OnDeviceCapabilityDebug />)
    expect(await screen.findByText('NOT CAPABLE')).toBeInTheDocument()
    expect(row('this device')).toHaveTextContent('mobile')
    expect(row('WebGPU')).toHaveTextContent('no')
    expect(row('device memory')).toHaveTextContent('unknown')
    expect(row('GPU vendor')).toHaveTextContent('—')
    expect(row('storage quota')).toHaveTextContent('—')
  })
})

describe('OnDeviceCapabilitySkeleton', () => {
  it('lists every readout label', () => {
    render(<OnDeviceCapabilitySkeleton />)
    for (const l of ['reason', 'this device', 'storage quota', 'model cached']) expect(screen.getByText(l)).toBeInTheDocument()
  })
})
