import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { detectOnDeviceCapability, MODEL_CACHE_NAME } from '@/lib/on-device/capability'

const MB = 1024 * 1024

// Snapshots of globals we mutate, restored in afterEach
let savedNavigator: PropertyDescriptor | undefined
let savedCaches: PropertyDescriptor | undefined
let savedWindow: PropertyDescriptor | undefined

function setNavigator(nav: Record<string, unknown>) {
  Object.defineProperty(globalThis, 'navigator', {
    value: nav,
    configurable: true,
    writable: true,
  })
}

function setCaches(value: unknown) {
  Object.defineProperty(globalThis, 'caches', {
    value,
    configurable: true,
    writable: true,
  })
}

/** Build a navigator that passes every gate by default (desktop). */
function makeGoodNavigator(overrides: Record<string, unknown> = {}) {
  const adapter = {
    limits: {
      maxBufferSize: 1024 * MB, // 1024 MB >= 512
      maxStorageBufferBindingSize: 512 * MB, // 512 MB >= 256
    },
    info: { vendor: 'nvidia' },
  }
  return {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Desktop',
    deviceMemory: 8,
    connection: undefined, // no connection API -> wifi null -> pass through
    storage: {
      estimate: vi.fn().mockResolvedValue({ quota: 2048 * MB }),
    },
    gpu: {
      requestAdapter: vi.fn().mockResolvedValue(adapter),
    },
    ...overrides,
  }
}

describe('on-device/capability', () => {
  beforeEach(() => {
    savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    savedCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches')
    savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    // Default: no caches API present unless a test overrides it
    setCaches(undefined)
  })

  afterEach(() => {
    if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator)
    if (savedCaches) Object.defineProperty(globalThis, 'caches', savedCaches)
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
    vi.clearAllMocks()
  })

  it('exports the model cache name constant', () => {
    expect(MODEL_CACHE_NAME).toBe('jeffi-on-device-model-v1')
  })

  it('returns "no-window" when window is undefined', async () => {
    // @ts-expect-error intentionally removing window
    delete globalThis.window
    const v = await detectOnDeviceCapability()
    expect(v.capable).toBe(false)
    expect(v.reason).toBe('no-window')
  })

  it('returns "no-window" when navigator is undefined', async () => {
    // @ts-expect-error intentionally removing navigator
    delete globalThis.navigator
    const v = await detectOnDeviceCapability()
    expect(v.capable).toBe(false)
    expect(v.reason).toBe('no-window')
  })

  it('blocks with "not-wifi" when saveData is enabled', async () => {
    setNavigator(makeGoodNavigator({ connection: { saveData: true } }))
    const v = await detectOnDeviceCapability()
    expect(v.reason).toBe('not-wifi')
    expect(v.details.isWifi).toBe(false)
  })

  it('blocks with "not-wifi" on cellular connection', async () => {
    setNavigator(makeGoodNavigator({ connection: { type: 'cellular' } }))
    const v = await detectOnDeviceCapability()
    expect(v.reason).toBe('not-wifi')
    expect(v.details.isWifi).toBe(false)
  })

  it('allows wifi connection (isWifi true) and reaches ok', async () => {
    setNavigator(makeGoodNavigator({ connection: { type: 'wifi' } }))
    const v = await detectOnDeviceCapability()
    expect(v.details.isWifi).toBe(true)
    expect(v.reason).toBe('ok')
    expect(v.capable).toBe(true)
  })

  it('treats "unknown" connection type as null (pass through)', async () => {
    setNavigator(makeGoodNavigator({ connection: { type: 'unknown' } }))
    const v = await detectOnDeviceCapability()
    expect(v.details.isWifi).toBeNull()
    expect(v.reason).toBe('ok')
  })

  it('treats absent connection.type as null (pass through)', async () => {
    setNavigator(makeGoodNavigator({ connection: {} }))
    const v = await detectOnDeviceCapability()
    expect(v.details.isWifi).toBeNull()
    expect(v.reason).toBe('ok')
  })

  it('returns "no-webgpu" when navigator.gpu is missing', async () => {
    setNavigator(makeGoodNavigator({ gpu: undefined }))
    const v = await detectOnDeviceCapability()
    expect(v.reason).toBe('no-webgpu')
    expect(v.details.hasWebGPU).toBe(false)
  })

  it('returns "no-adapter" when requestAdapter resolves null', async () => {
    setNavigator(
      makeGoodNavigator({
        gpu: { requestAdapter: vi.fn().mockResolvedValue(null) },
      }),
    )
    const v = await detectOnDeviceCapability()
    expect(v.reason).toBe('no-adapter')
    expect(v.details.hasWebGPU).toBe(true)
    expect(v.details.hasAdapter).toBe(false)
  })

  it('returns "low-memory" on desktop when deviceMemory is null', async () => {
    const nav = makeGoodNavigator()
    delete (nav as Record<string, unknown>).deviceMemory
    setNavigator(nav)
    const v = await detectOnDeviceCapability()
    expect(v.reason).toBe('low-memory')
    expect(v.details.deviceMemoryGB).toBeNull()
  })

  it('returns "low-memory" on desktop when deviceMemory below threshold', async () => {
    setNavigator(makeGoodNavigator({ deviceMemory: 2 }))
    const v = await detectOnDeviceCapability()
    expect(v.reason).toBe('low-memory')
    expect(v.details.deviceMemoryGB).toBe(2)
  })

  it('returns "gpu-limits-too-small" on desktop when buffer limit too small', async () => {
    setNavigator(
      makeGoodNavigator({
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue({
            limits: {
              maxBufferSize: 100 * MB, // < 512
              maxStorageBufferBindingSize: 512 * MB,
            },
            info: { vendor: 'amd' },
          }),
        },
      }),
    )
    const v = await detectOnDeviceCapability()
    expect(v.reason).toBe('gpu-limits-too-small')
    expect(v.details.gpuVendor).toBe('amd')
  })

  it('returns "gpu-limits-too-small" when storage binding limit too small', async () => {
    setNavigator(
      makeGoodNavigator({
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue({
            limits: {
              maxBufferSize: 1024 * MB,
              maxStorageBufferBindingSize: 10 * MB, // < 256
            },
            info: { vendor: 'intel' },
          }),
        },
      }),
    )
    const v = await detectOnDeviceCapability()
    expect(v.reason).toBe('gpu-limits-too-small')
  })

  it('returns full capable verdict on a good desktop and requests high-performance adapter', async () => {
    const nav = makeGoodNavigator()
    setNavigator(nav)
    const v = await detectOnDeviceCapability()
    expect(v.capable).toBe(true)
    expect(v.reason).toBe('ok')
    expect(v.details).toMatchObject({
      hasWebGPU: true,
      hasAdapter: true,
      deviceMemoryGB: 8,
      maxBufferSizeMB: 1024,
      maxStorageBufferBindingSizeMB: 512,
      gpuVendor: 'nvidia',
      storageQuotaMB: 2048,
      isMobile: false,
    })
    // Desktop path passes powerPreference: high-performance
    expect((nav.gpu.requestAdapter as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      powerPreference: 'high-performance',
    })
  })

  it('handles missing adapter.limits by treating limits as empty (null MB) -> gpu-limits-too-small', async () => {
    setNavigator(
      makeGoodNavigator({
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue({ info: { vendor: 'v' } }),
        },
      }),
    )
    const v = await detectOnDeviceCapability()
    expect(v.details.maxBufferSizeMB).toBeNull()
    expect(v.reason).toBe('gpu-limits-too-small')
  })

  it('returns "error" when requestAdapter throws', async () => {
    setNavigator(
      makeGoodNavigator({
        gpu: {
          requestAdapter: vi.fn().mockRejectedValue(new Error('boom')),
        },
      }),
    )
    const v = await detectOnDeviceCapability()
    expect(v.reason).toBe('error')
    expect(v.capable).toBe(false)
  })

  // ---- mobile behaviour ----

  it('detects mobile via userAgent and uses relaxed thresholds (no powerPreference)', async () => {
    const nav = makeGoodNavigator({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile',
      deviceMemory: undefined, // mobile hides deviceMemory; must still pass
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({
          limits: {
            maxBufferSize: 300 * MB, // >= 256 mobile min
            maxStorageBufferBindingSize: 150 * MB, // >= 128 mobile min
          },
          info: { vendor: 'apple' },
        }),
      },
    })
    delete (nav as Record<string, unknown>).deviceMemory
    setNavigator(nav)
    const v = await detectOnDeviceCapability()
    expect(v.details.isMobile).toBe(true)
    expect(v.reason).toBe('ok')
    expect(v.capable).toBe(true)
    // Mobile passes undefined opts to requestAdapter
    expect((nav.gpu.requestAdapter as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(undefined)
  })

  it('blocks a budget mobile with known deviceMemory < 3 GB', async () => {
    setNavigator(
      makeGoodNavigator({
        userAgent: 'Android Mobile',
        deviceMemory: 2,
      }),
    )
    const v = await detectOnDeviceCapability()
    expect(v.details.isMobile).toBe(true)
    expect(v.reason).toBe('low-memory')
  })

  it('detects mobile via userAgentData.mobile flag', async () => {
    const nav = makeGoodNavigator({
      userAgent: 'SomeDesktopUA',
      userAgentData: { mobile: true },
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({
          limits: {
            maxBufferSize: 300 * MB,
            maxStorageBufferBindingSize: 150 * MB,
          },
          info: { vendor: 'arm' },
        }),
      },
    })
    setNavigator(nav)
    const v = await detectOnDeviceCapability()
    expect(v.details.isMobile).toBe(true)
    expect(v.reason).toBe('ok')
  })

  it('mobile relaxed thresholds still block when below mobile minimums', async () => {
    setNavigator(
      makeGoodNavigator({
        userAgent: 'Android Mobile',
        deviceMemory: 4,
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue({
            limits: {
              maxBufferSize: 100 * MB, // < 256 mobile min
              maxStorageBufferBindingSize: 150 * MB,
            },
            info: { vendor: 'arm' },
          }),
        },
      }),
    )
    const v = await detectOnDeviceCapability()
    expect(v.reason).toBe('gpu-limits-too-small')
  })

  // ---- vendor detection via requestAdapterInfo fallback ----

  it('resolves gpuVendor via requestAdapterInfo when adapter.info absent', async () => {
    setNavigator(
      makeGoodNavigator({
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue({
            limits: {
              maxBufferSize: 1024 * MB,
              maxStorageBufferBindingSize: 512 * MB,
            },
            requestAdapterInfo: vi.fn().mockResolvedValue({ vendor: 'qualcomm' }),
          }),
        },
      }),
    )
    const v = await detectOnDeviceCapability()
    expect(v.details.gpuVendor).toBe('qualcomm')
    expect(v.reason).toBe('ok')
  })

  it('leaves gpuVendor null when requestAdapterInfo returns no vendor', async () => {
    setNavigator(
      makeGoodNavigator({
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue({
            limits: {
              maxBufferSize: 1024 * MB,
              maxStorageBufferBindingSize: 512 * MB,
            },
            requestAdapterInfo: vi.fn().mockResolvedValue({}),
          }),
        },
      }),
    )
    const v = await detectOnDeviceCapability()
    expect(v.details.gpuVendor).toBeNull()
    expect(v.reason).toBe('ok')
  })

  it('ignores errors thrown by requestAdapterInfo (vendor stays null)', async () => {
    setNavigator(
      makeGoodNavigator({
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue({
            limits: {
              maxBufferSize: 1024 * MB,
              maxStorageBufferBindingSize: 512 * MB,
            },
            requestAdapterInfo: vi.fn().mockRejectedValue(new Error('nope')),
          }),
        },
      }),
    )
    const v = await detectOnDeviceCapability()
    expect(v.details.gpuVendor).toBeNull()
    expect(v.reason).toBe('ok')
  })

  // ---- storage quota + model cache branches ----

  it('sets storageQuotaMB null when storage.estimate is absent', async () => {
    setNavigator(makeGoodNavigator({ storage: {} }))
    const v = await detectOnDeviceCapability()
    expect(v.details.storageQuotaMB).toBeNull()
  })

  it('sets storageQuotaMB null when storage.estimate throws', async () => {
    setNavigator(
      makeGoodNavigator({
        storage: { estimate: vi.fn().mockRejectedValue(new Error('fail')) },
      }),
    )
    const v = await detectOnDeviceCapability()
    expect(v.details.storageQuotaMB).toBeNull()
  })

  it('sets storageQuotaMB null when quota is zero/invalid (mb guard)', async () => {
    setNavigator(
      makeGoodNavigator({
        storage: { estimate: vi.fn().mockResolvedValue({ quota: 0 }) },
      }),
    )
    const v = await detectOnDeviceCapability()
    expect(v.details.storageQuotaMB).toBeNull()
  })

  it('reports modelCached true when the cache has keys', async () => {
    setCaches({
      open: vi.fn().mockResolvedValue({
        keys: vi.fn().mockResolvedValue([{}, {}]),
      }),
    })
    setNavigator(makeGoodNavigator())
    const v = await detectOnDeviceCapability()
    expect(v.details.modelCached).toBe(true)
  })

  it('reports modelCached false when the cache is empty', async () => {
    setCaches({
      open: vi.fn().mockResolvedValue({
        keys: vi.fn().mockResolvedValue([]),
      }),
    })
    setNavigator(makeGoodNavigator())
    const v = await detectOnDeviceCapability()
    expect(v.details.modelCached).toBe(false)
  })

  it('reports modelCached false when caches.open throws', async () => {
    setCaches({
      open: vi.fn().mockRejectedValue(new Error('cache error')),
    })
    setNavigator(makeGoodNavigator())
    const v = await detectOnDeviceCapability()
    expect(v.details.modelCached).toBe(false)
  })

  it('reports modelCached false when caches global is undefined', async () => {
    setCaches(undefined)
    setNavigator(makeGoodNavigator())
    const v = await detectOnDeviceCapability()
    expect(v.details.modelCached).toBe(false)
  })

  it('detectMobile swallows userAgent access errors and returns not-mobile', async () => {
    // navigator with a userAgent getter that throws forces the catch in detectMobile
    const nav = makeGoodNavigator()
    Object.defineProperty(nav, 'userAgent', {
      get() {
        throw new Error('ua blocked')
      },
      configurable: true,
    })
    setNavigator(nav)
    const v = await detectOnDeviceCapability()
    // detectMobile catch -> false; everything else good -> capable
    expect(v.details.isMobile).toBe(false)
    expect(v.reason).toBe('ok')
  })
})
