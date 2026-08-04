import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// --- Mock the prompt builders so we can assert what runtime passes through ---
vi.mock('@/lib/on-device/prompt', () => ({
  buildRecapPrompt: vi.fn(() => 'RECAP_PROMPT'),
  buildCartInsightPrompt: vi.fn(() => 'CART_PROMPT'),
  buildProductPitchPrompt: vi.fn(() => 'PITCH_PROMPT'),
  buildAffirmationPrompt: vi.fn(() => 'AFFIRM_PROMPT'),
}))

// --- Mock capability detection ---
const detectMock = vi.fn()
vi.mock('@/lib/on-device/capability', () => ({
  detectOnDeviceCapability: (...a: unknown[]) => detectMock(...a),
}))

// --- Fake Worker implementation ---
type Listener = (e: unknown) => void
class FakeWorker {
  static instances: FakeWorker[] = []
  posted: unknown[] = []
  terminated = false
  listeners: Record<string, Listener[]> = {}
  constructor(_url: unknown, _opts?: unknown) {
    FakeWorker.instances.push(this)
  }
  postMessage(msg: unknown) {
    this.posted.push(msg)
  }
  addEventListener(type: string, cb: Listener) {
    ;(this.listeners[type] ||= []).push(cb)
  }
  terminate() {
    this.terminated = true
  }
  emit(type: string, event: unknown) {
    ;(this.listeners[type] || []).forEach((cb) => cb(event))
  }
  emitMessage(data: unknown) {
    this.emit('message', { data })
  }
}

// runtime.ts uses `new URL('./summary.worker.ts', import.meta.url)` — happy-dom
// can construct URL, and we replace the Worker global with our fake.
const OriginalWorker = (globalThis as unknown as { Worker?: unknown }).Worker

let runtime: typeof import('@/lib/on-device/runtime')

async function freshImport() {
  vi.resetModules()
  FakeWorker.instances = []
  ;(globalThis as unknown as { Worker: unknown }).Worker = FakeWorker
  runtime = await import('@/lib/on-device/runtime')
}

beforeEach(async () => {
  vi.clearAllMocks()
  await freshImport()
})

afterEach(() => {
  ;(globalThis as unknown as { Worker: unknown }).Worker = OriginalWorker
})

describe('canRunOnDeviceSummary', () => {
  it('maps capability verdict to capable/reason/isMobile', async () => {
    detectMock.mockResolvedValue({
      capable: true,
      reason: 'ok',
      details: { isMobile: true },
    })
    const res = await runtime.canRunOnDeviceSummary()
    expect(res).toEqual({ capable: true, reason: 'ok', isMobile: true })
  })

  it('propagates incapable verdict', async () => {
    detectMock.mockResolvedValue({
      capable: false,
      reason: 'no-webgpu',
      details: { isMobile: false },
    })
    const res = await runtime.canRunOnDeviceSummary()
    expect(res.capable).toBe(false)
    expect(res.reason).toBe('no-webgpu')
    expect(res.isMobile).toBe(false)
  })
})

describe('getLastOnDeviceError', () => {
  it('is null before any error', () => {
    expect(runtime.getLastOnDeviceError()).toBeNull()
  })
})

describe('generateRecap — worker lifecycle & result', () => {
  it('creates a worker lazily, sends init then generate, and resolves on result', async () => {
    const promise = runtime.generateRecap(
      { cart: [], events: [] } as never,
      true,
    )
    const w = FakeWorker.instances[0]
    expect(FakeWorker.instances).toHaveLength(1)
    // init message first, then generate
    expect(w.posted[0]).toEqual({ type: 'init', isMobile: true })
    const gen = w.posted[1] as { type: string; id: number; prompt: string }
    expect(gen.type).toBe('generate')
    expect(gen.prompt).toBe('RECAP_PROMPT')

    w.emitMessage({ type: 'result', id: gen.id, text: 'Final answer' })
    await expect(promise).resolves.toBe('Final answer')
  })

  it('reuses the same worker on a second call (idempotent)', async () => {
    runtime.generateRecap({ cart: [] } as never, false)
    runtime.generateRecap({ cart: [] } as never, false)
    expect(FakeWorker.instances).toHaveLength(1)
    // Only one init message even with two generate calls
    const w = FakeWorker.instances[0]
    const inits = w.posted.filter((m) => (m as { type: string }).type === 'init')
    expect(inits).toHaveLength(1)
  })

  it('streams tokens via onToken and falls back to accumulator when result has no text', async () => {
    const tokens: string[] = []
    const promise = runtime.generateRecap(
      { cart: [] } as never,
      false,
      (partial) => tokens.push(partial),
    )
    const w = FakeWorker.instances[0]
    const gen = w.posted[1] as { id: number }
    // No repetition -> deloop returns the (untrimmed) original accumulator
    w.emitMessage({ type: 'token', id: gen.id, text: 'Hello ' })
    w.emitMessage({ type: 'token', id: gen.id, text: 'world' })
    expect(tokens).toEqual(['Hello ', 'Hello world'])
    // result with empty text -> resolves with accumulated tokens
    w.emitMessage({ type: 'result', id: gen.id, text: '' })
    await expect(promise).resolves.toBe('Hello world')
  })

  it('rejects on per-request error message', async () => {
    const promise = runtime.generateRecap({ cart: [] } as never, false)
    const w = FakeWorker.instances[0]
    const gen = w.posted[1] as { id: number }
    w.emitMessage({ type: 'error', id: gen.id, error: 'boom' })
    await expect(promise).rejects.toThrow('boom')
  })

  it('ignores messages for unknown / already-settled ids', async () => {
    const promise = runtime.generateRecap({ cart: [] } as never, false)
    const w = FakeWorker.instances[0]
    const gen = w.posted[1] as { id: number }
    // unknown id — should be ignored, promise stays pending
    w.emitMessage({ type: 'token', id: 9999, text: 'x' })
    w.emitMessage({ type: 'result', id: 9999, text: 'y' })
    w.emitMessage({ type: 'error', id: 9999, error: 'z' })
    // real result settles it
    w.emitMessage({ type: 'result', id: gen.id, text: 'done' })
    await expect(promise).resolves.toBe('done')
  })
})

describe('deloop (exercised via streaming tokens)', () => {
  it('trims a repeating word sequence in streamed output', async () => {
    let last = ''
    const promise = runtime.generateRecap(
      { cart: [] } as never,
      false,
      (partial) => {
        last = partial
      },
    )
    const w = FakeWorker.instances[0]
    const gen = w.posted[1] as { id: number }
    // "Build Your Quality Build Your Quality" -> deloop keeps first occurrence
    w.emitMessage({
      type: 'token',
      id: gen.id,
      text: 'Build Your Quality Build Your Quality',
    })
    expect(last).toBe('Build Your Quality')
    w.emitMessage({ type: 'result', id: gen.id, text: 'Build Your Quality' })
    await promise
  })

  it('returns text unchanged when no repetition present', async () => {
    let last = ''
    const promise = runtime.generateRecap(
      { cart: [] } as never,
      false,
      (partial) => {
        last = partial
      },
    )
    const w = FakeWorker.instances[0]
    const gen = w.posted[1] as { id: number }
    w.emitMessage({ type: 'token', id: gen.id, text: 'one two three four' })
    expect(last).toBe('one two three four')
    w.emitMessage({ type: 'result', id: gen.id, text: 'one two three four' })
    await promise
  })
})

describe('worker-level failures (failAll)', () => {
  it('load-error rejects all pending and records lastError', async () => {
    const p1 = runtime.generateRecap({ cart: [] } as never, false)
    const p2 = runtime.generateCartInsight({ cart: [] } as never, false)
    const w = FakeWorker.instances[0]
    w.emitMessage({ type: 'load-error', error: 'model 404' })
    await expect(p1).rejects.toThrow('model 404')
    await expect(p2).rejects.toThrow('model 404')
    expect(runtime.getLastOnDeviceError()).toBe('model 404')
  })

  it('load-error without message uses default reason', async () => {
    const p1 = runtime.generateRecap({ cart: [] } as never, false)
    const w = FakeWorker.instances[0]
    w.emitMessage({ type: 'load-error' })
    await expect(p1).rejects.toThrow('model load failed')
    expect(runtime.getLastOnDeviceError()).toBe('model load failed')
  })

  it("worker 'error' event rejects pending with the event message", async () => {
    const p1 = runtime.generateRecap({ cart: [] } as never, false)
    const w = FakeWorker.instances[0]
    w.emit('error', { message: 'crashed hard' })
    await expect(p1).rejects.toThrow('crashed hard')
    expect(runtime.getLastOnDeviceError()).toBe('crashed hard')
  })

  it("worker 'error' event without message uses default", async () => {
    const p1 = runtime.generateRecap({ cart: [] } as never, false)
    const w = FakeWorker.instances[0]
    w.emit('error', {})
    await expect(p1).rejects.toThrow('worker crashed')
  })

  it("worker 'messageerror' rejects pending", async () => {
    const p1 = runtime.generateRecap({ cart: [] } as never, false)
    const w = FakeWorker.instances[0]
    w.emit('messageerror', {})
    await expect(p1).rejects.toThrow('worker message error')
  })
})

describe('generateCartInsight / generateProductPitch / generateAffirmation', () => {
  it('generateCartInsight uses the cart-insight prompt', async () => {
    const promise = runtime.generateCartInsight({ cart: [] } as never, true)
    const w = FakeWorker.instances[0]
    const gen = w.posted[1] as { prompt: string; id: number }
    expect(gen.prompt).toBe('CART_PROMPT')
    w.emitMessage({ type: 'result', id: gen.id, text: 'ci' })
    await expect(promise).resolves.toBe('ci')
  })

  it('generateProductPitch uses the pitch prompt', async () => {
    const promise = runtime.generateProductPitch(
      'Widget',
      'Acme',
      'Tools',
      null,
      false,
    )
    const w = FakeWorker.instances[0]
    const gen = w.posted[1] as { prompt: string; id: number }
    expect(gen.prompt).toBe('PITCH_PROMPT')
    w.emitMessage({ type: 'result', id: gen.id, text: 'pitch' })
    await expect(promise).resolves.toBe('pitch')
  })

  it('generateAffirmation uses the affirmation prompt', async () => {
    const promise = runtime.generateAffirmation(['a', 'b'], 100, null, false)
    const w = FakeWorker.instances[0]
    const gen = w.posted[1] as { prompt: string; id: number }
    expect(gen.prompt).toBe('AFFIRM_PROMPT')
    w.emitMessage({ type: 'result', id: gen.id, text: 'aff' })
    await expect(promise).resolves.toBe('aff')
  })
})

describe('disposeSummarizer', () => {
  it('terminates the worker, clears pending and allows a new worker afterward', async () => {
    runtime.generateRecap({ cart: [] } as never, false)
    const w = FakeWorker.instances[0]
    expect(w.terminated).toBe(false)

    runtime.disposeSummarizer()
    expect(w.terminated).toBe(true)

    // A subsequent generate creates a brand-new worker
    runtime.generateRecap({ cart: [] } as never, false)
    expect(FakeWorker.instances).toHaveLength(2)
  })

  it('is a no-op when there is no worker', () => {
    expect(() => runtime.disposeSummarizer()).not.toThrow()
    expect(FakeWorker.instances).toHaveLength(0)
  })
})
