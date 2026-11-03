'use client'

import OnDeviceCapabilityDebug from '@/components/on-device/OnDeviceCapabilityDebug'

/**
 * Dev-only diagnostics page for the on-device model capability gate.
 * Open /dev/on-device on any device to see whether it qualifies and why.
 */
export default function OnDeviceDevPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 bg-surface">
      <h1 className="text-lg font-bold text-foreground">On-device capability check</h1>
      <OnDeviceCapabilityDebug />
      <p className="text-xs text-foreground-muted max-w-sm text-center">
        This checks WebGPU, device memory and GPU limits. The Gemma 3 270M checkout summary only runs on devices that
        report CAPABLE.
      </p>
    </div>
  )
}
