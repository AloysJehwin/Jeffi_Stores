'use client'

import { useEffect, useState } from 'react'
import { detectOnDeviceCapability, type CapabilityVerdict } from '@/lib/on-device/capability'
import { useStoreConfig } from '@/contexts/StoreConfigContext'

/**
 * Debug readout for the on-device model capability gate. Drop this on any page
 * during development to see whether the current device qualifies and why. Not
 * meant for production placement — it's a diagnostic panel.
 */
export default function OnDeviceCapabilityDebug() {
  const [verdict, setVerdict] = useState<CapabilityVerdict | null>(null)
  const flagEnabled = useStoreConfig().flags.ondeviceSummaryEnabled
  const finetuneFlag = useStoreConfig().flags.ondeviceFinetuneEnabled

  useEffect(() => {
    let alive = true
    detectOnDeviceCapability().then(v => { if (alive) setVerdict(v) })
    return () => { alive = false }
  }, [])

  if (!verdict) {
    return <div className="text-xs text-foreground-muted p-3">Checking device capability…</div>
  }

  const d = verdict.details
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex justify-between gap-4 py-0.5">
      <span className="text-foreground-muted">{k}</span>
      <span className="font-mono text-foreground">{v}</span>
    </div>
  )

  return (
    <div className="max-w-sm rounded-lg border border-border-default bg-surface-elevated p-4 text-xs">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-foreground">On-device model</span>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${verdict.capable ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {verdict.capable ? 'CAPABLE' : 'NOT CAPABLE'}
        </span>
      </div>
      <Row k="reason" v={verdict.reason} />
      <div className="border-t border-border-default my-2" />
      <Row k="feature flag" v={flagEnabled ? 'enabled' : 'disabled'} />
      <Row k="fine-tune flag" v={finetuneFlag ? 'enabled' : 'disabled'} />
      <Row k="WebGPU" v={d.hasWebGPU ? 'yes' : 'no'} />
      <Row k="GPU adapter" v={d.hasAdapter ? 'yes' : 'no'} />
      <Row k="GPU vendor" v={d.gpuVendor ?? '—'} />
      <Row k="device memory" v={d.deviceMemoryGB != null ? `${d.deviceMemoryGB} GB` : 'unknown'} />
      <Row k="max buffer" v={d.maxBufferSizeMB != null ? `${d.maxBufferSizeMB} MB` : '—'} />
      <Row k="max storage binding" v={d.maxStorageBufferBindingSizeMB != null ? `${d.maxStorageBufferBindingSizeMB} MB` : '—'} />
      <Row k="storage quota" v={d.storageQuotaMB != null ? `${d.storageQuotaMB} MB` : '—'} />
      <Row k="model cached" v={d.modelCached ? 'yes' : 'no'} />
    </div>
  )
}
