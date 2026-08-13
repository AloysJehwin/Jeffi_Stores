/**
 * On-device model capability gate.
 *
 * Decides whether THIS device/browser can realistically run the on-device
 * Gemma 3 270M checkout-summary model. Pure feature detection — no model
 * download, no heavy work. Runs client-side only.
 *
 * Policy (HARDWARE ONLY — the enable/disable decision lives in the DB feature
 * flag `feature_ondevice_summary_enabled`, which each consumer checks via
 * useStoreConfig().flags.ondeviceSummaryEnabled BEFORE calling this):
 * - WebGPU adapter present
 * - Memory >= 4 GB (desktop) or WebGPU passes (mobile — deviceMemory unreliable)
 * - GPU buffer limits large enough (relaxed thresholds for mobile)
 * - Real Wi-Fi or ethernet (blocks cellular/hotspot, respects saveData)
 */

interface GPUAdapterLike {
  limits: Record<string, number>
  info?: { vendor?: string; architecture?: string; device?: string; description?: string }
  requestAdapterInfo?: () => Promise<{ vendor?: string; architecture?: string; description?: string }>
}
interface GPULike {
  requestAdapter: (opts?: { powerPreference?: 'low-power' | 'high-performance' }) => Promise<GPUAdapterLike | null>
}
interface NavigatorWithGPU extends Navigator {
  gpu?: GPULike
  deviceMemory?: number
  connection?: {
    type?: string
    effectiveType?: string
    saveData?: boolean
  }
}

export interface CapabilityVerdict {
  capable: boolean
  reason:
    | 'ok'
    | 'disabled'
    | 'no-window'
    | 'no-webgpu'
    | 'no-adapter'
    | 'low-memory'
    | 'gpu-limits-too-small'
    | 'not-wifi'
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
    isWifi: boolean | null
    isMobile: boolean
  }
}

// Desktop thresholds
const MIN_DEVICE_MEMORY_GB = 4
const MIN_MAX_BUFFER_MB = 512
const MIN_MAX_STORAGE_BINDING_MB = 256

// Mobile relaxed thresholds — mobile GPUs have smaller limits but can still run q4
const MIN_MAX_BUFFER_MB_MOBILE = 256
const MIN_MAX_STORAGE_BINDING_MB_MOBILE = 128

export const MODEL_CACHE_NAME = 'jeffi-on-device-model-v1'

function mb(bytes: number | undefined): number | null {
  return typeof bytes === 'number' && bytes > 0 ? Math.round(bytes / (1024 * 1024)) : null
}

function detectMobile(): boolean {
  try {
    if ((navigator as any).userAgentData?.mobile) return true
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  } catch { return false }
}

function detectWifi(nav: NavigatorWithGPU): boolean | null {
  const conn = nav.connection
  if (!conn) return null // API not available — don't block (desktop browsers)
  if (conn.saveData) return false
  const t = conn.type
  if (!t || t === 'unknown') return null // unknown → allow
  return t === 'wifi' || t === 'ethernet'
}

async function isModelCached(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false
    const c = await caches.open(MODEL_CACHE_NAME)
    const keys = await c.keys()
    return keys.length > 0
  } catch { return false }
}

async function storageQuotaMB(): Promise<number | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const est = await navigator.storage.estimate()
    return mb(est.quota)
  } catch { return null }
}

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
    isWifi: null,
    isMobile: false,
  }

  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { capable: false, reason: 'no-window', details }
  }

  try {
    const nav = navigator as NavigatorWithGPU
    details.isMobile = detectMobile()
    details.isWifi = detectWifi(nav)
    details.deviceMemoryGB = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null
    details.storageQuotaMB = await storageQuotaMB()
    details.modelCached = await isModelCached()

    // Wi-Fi gate — block cellular/hotspot. null means API absent → pass through.
    if (details.isWifi === false) {
      return { capable: false, reason: 'not-wifi', details }
    }

    if (!nav.gpu) {
      return { capable: false, reason: 'no-webgpu', details }
    }
    details.hasWebGPU = true

    // On mobile don't request high-performance (may return null on integrated-only devices)
    const adapterOpts = details.isMobile ? undefined : { powerPreference: 'high-performance' as const }
    const adapter = await nav.gpu.requestAdapter(adapterOpts)
    if (!adapter) {
      return { capable: false, reason: 'no-adapter', details }
    }
    details.hasAdapter = true

    const limits = adapter.limits || {}
    details.maxBufferSizeMB = mb(limits.maxBufferSize)
    details.maxStorageBufferBindingSizeMB = mb(limits.maxStorageBufferBindingSize)

    try {
      if (adapter.info?.vendor) details.gpuVendor = adapter.info.vendor
      else if (adapter.requestAdapterInfo) {
        const info = await adapter.requestAdapterInfo()
        details.gpuVendor = info?.vendor || null
      }
    } catch { /* ignore */ }

    // Memory gate — relaxed for mobile (Safari/Firefox don't expose deviceMemory)
    if (!details.isMobile) {
      if (details.deviceMemoryGB == null || details.deviceMemoryGB < MIN_DEVICE_MEMORY_GB) {
        return { capable: false, reason: 'low-memory', details }
      }
    }
    // On mobile: if deviceMemory is known and < 3 GB, block (budget phones)
    if (details.isMobile && details.deviceMemoryGB != null && details.deviceMemoryGB < 3) {
      return { capable: false, reason: 'low-memory', details }
    }

    // GPU limits gate — use relaxed thresholds on mobile
    const bufMin = details.isMobile ? MIN_MAX_BUFFER_MB_MOBILE : MIN_MAX_BUFFER_MB
    const bindMin = details.isMobile ? MIN_MAX_STORAGE_BINDING_MB_MOBILE : MIN_MAX_STORAGE_BINDING_MB
    const bufOk = (details.maxBufferSizeMB ?? 0) >= bufMin
    const bindOk = (details.maxStorageBufferBindingSizeMB ?? 0) >= bindMin
    if (!bufOk || !bindOk) {
      return { capable: false, reason: 'gpu-limits-too-small', details }
    }

    return { capable: true, reason: 'ok', details }
  } catch {
    return { capable: false, reason: 'error', details }
  }
}
