/**
 * On-device model capability gate.
 *
 * Decides whether THIS device/browser can realistically run the on-device
 * Gemma 3 270M checkout-summary model. Pure feature detection — no model
 * download, no heavy work. Runs client-side only.
 *
 * Policy (strict): WebGPU adapter present AND navigator.deviceMemory >= 4 GB
 * AND the GPU adapter's limits are large enough for the model's tensors. Devices
 * that fail are silently excluded (the summary UI simply never renders).
 *
 * The whole check is additionally gated by the feature flag — when the flag is
 * off, the gate short-circuits to reason:'disabled' before any probing.
 */

import { isOnDeviceSummaryEnabled } from './flag'

// ── Minimal local WebGPU typings (avoids adding @webgpu/types as a dep) ──────
interface GPUAdapterLike {
  limits: Record<string, number>
  // Some browsers expose adapter.info; optional.
  info?: { vendor?: string; architecture?: string; device?: string; description?: string }
  requestAdapterInfo?: () => Promise<{ vendor?: string; architecture?: string; description?: string }>
}
interface GPULike {
  requestAdapter: (opts?: { powerPreference?: 'low-power' | 'high-performance' }) => Promise<GPUAdapterLike | null>
}
interface NavigatorWithGPU extends Navigator {
  gpu?: GPULike
  deviceMemory?: number
}

export interface CapabilityVerdict {
  capable: boolean
  /** Machine-readable reason when not capable (for telemetry/debug). */
  reason:
    | 'ok'
    | 'disabled'
    | 'no-window'
    | 'no-webgpu'
    | 'no-adapter'
    | 'low-memory'
    | 'gpu-limits-too-small'
    | 'error'
  details: {
    hasWebGPU: boolean
    hasAdapter: boolean
    deviceMemoryGB: number | null
    maxBufferSizeMB: number | null
    maxStorageBufferBindingSizeMB: number | null
    gpuVendor: string | null
    storageQuotaMB: number | null
    modelCached: boolean
  }
}

// Minimum thresholds. Kept conservative for a smooth experience where it runs.
const MIN_DEVICE_MEMORY_GB = 4
// Gemma 3 270M (q4) tensors — a single weight buffer can be a few hundred MB.
// Require headroom so binding a large buffer won't fail.
const MIN_MAX_BUFFER_MB = 512
const MIN_MAX_STORAGE_BINDING_MB = 256

/** Cache key for the model blob in the Cache Storage API. */
export const MODEL_CACHE_NAME = 'jeffi-on-device-model-v1'

function mb(bytes: number | undefined): number | null {
  return typeof bytes === 'number' && bytes > 0 ? Math.round(bytes / (1024 * 1024)) : null
}

/** Whether the model has already been downloaded & cached on this device. */
async function isModelCached(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false
    const c = await caches.open(MODEL_CACHE_NAME)
    const keys = await c.keys()
    return keys.length > 0
  } catch {
    return false
  }
}

async function storageQuotaMB(): Promise<number | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const est = await navigator.storage.estimate()
    return mb(est.quota)
  } catch {
    return null
  }
}

/**
 * Run the full capability check. Safe to call anywhere — never throws.
 * Returns capable:false with a reason on any failure or unsupported environment.
 */
export async function detectOnDeviceCapability(): Promise<CapabilityVerdict> {
  const details: CapabilityVerdict['details'] = {
    hasWebGPU: false,
    hasAdapter: false,
    deviceMemoryGB: null,
    maxBufferSizeMB: null,
    maxStorageBufferBindingSizeMB: null,
    gpuVendor: null,
    storageQuotaMB: null,
    modelCached: false,
  }

  // Feature flag first — when off, do nothing at all.
  if (!isOnDeviceSummaryEnabled()) {
    return { capable: false, reason: 'disabled', details }
  }

  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { capable: false, reason: 'no-window', details }
  }

  try {
    const nav = navigator as NavigatorWithGPU

    // Device memory (coarse RAM proxy). Undefined on some browsers (Safari/FF) —
    // treat unknown as failing the strict gate rather than optimistically pass.
    details.deviceMemoryGB = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null
    details.storageQuotaMB = await storageQuotaMB()
    details.modelCached = await isModelCached()

    // WebGPU present?
    if (!nav.gpu) {
      return { capable: false, reason: 'no-webgpu', details }
    }
    details.hasWebGPU = true

    // Adapter available? (high-performance to prefer the discrete GPU)
    const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) {
      return { capable: false, reason: 'no-adapter', details }
    }
    details.hasAdapter = true

    const limits = adapter.limits || {}
    details.maxBufferSizeMB = mb(limits.maxBufferSize)
    details.maxStorageBufferBindingSizeMB = mb(limits.maxStorageBufferBindingSize)

    // GPU vendor (best-effort; API varies across browsers)
    try {
      if (adapter.info?.vendor) details.gpuVendor = adapter.info.vendor
      else if (adapter.requestAdapterInfo) {
        const info = await adapter.requestAdapterInfo()
        details.gpuVendor = info?.vendor || null
      }
    } catch { /* ignore */ }

    // Memory gate
    if (details.deviceMemoryGB == null || details.deviceMemoryGB < MIN_DEVICE_MEMORY_GB) {
      return { capable: false, reason: 'low-memory', details }
    }

    // GPU limits gate
    const bufOk = (details.maxBufferSizeMB ?? 0) >= MIN_MAX_BUFFER_MB
    const bindOk = (details.maxStorageBufferBindingSizeMB ?? 0) >= MIN_MAX_STORAGE_BINDING_MB
    if (!bufOk || !bindOk) {
      return { capable: false, reason: 'gpu-limits-too-small', details }
    }

    return { capable: true, reason: 'ok', details }
  } catch {
    return { capable: false, reason: 'error', details }
  }
}
