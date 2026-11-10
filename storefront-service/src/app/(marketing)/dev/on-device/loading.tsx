import { OnDeviceCapabilitySkeleton } from '@/components/on-device/OnDeviceCapabilityDebug'

export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 bg-surface">
      <h1 className="text-lg font-bold text-foreground">On-device capability check</h1>
      <OnDeviceCapabilitySkeleton />
      <p className="text-xs text-foreground-muted max-w-sm text-center">
        This checks WebGPU, device memory and GPU limits. The Gemma 3 270M checkout summary only runs on devices that
        report CAPABLE.
      </p>
    </div>
  )
}
