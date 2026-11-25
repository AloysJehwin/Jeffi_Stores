// @vitest-environment node
import { EventEmitter } from 'node:events'
import { describe, it, expect, vi } from 'vitest'
import { OllamaPool, isNetworkError, OllamaUnavailableError } from '../src/providers/ollama-pool'
import { JobWaiters } from '../src/job-waiters'
import { parseUrls } from '../src/config'
import {
  BackendProbe, RazerHealthMonitor, guardedMedia, httpCheck, isOutage, poolSource, RAZER_BACKEND,
} from '../src/razer-health'
import { ProviderError, type MediaProvider } from '../src/providers/types'

const A = 'http://10.42.0.1:11434'
const B = 'http://100.82.208.8:11434'

function netErr(code = 'ETIMEDOUT') {
  return Object.assign(new TypeError('fetch failed'), { cause: { code } })
}

function pool(up: Set<string>, opts: { now?: () => number; log?: (m: string) => void } = {}) {
  const fetchImpl = vi.fn(async (url: string) => {
    const base = url.replace(/\/api\/tags$/, '')
    if (up.has(base)) return new Response('{}', { status: 200 })
    throw netErr()
  }) as unknown as typeof fetch
  return { p: new OllamaPool([A, B], { fetchImpl, probeIntervalMs: 15_000, log: opts.log ?? (() => {}), now: opts.now }), fetchImpl }
}

describe('parseUrls', () => {
  it('splits, trims, strips trailing slashes and dedupes', () => {
    expect(parseUrls(` ${A}/ , ${B},,${A}`)).toEqual([A, B])
  })
})

describe('isNetworkError', () => {
  it('flags connection failures, not HTTP errors or our own aborts', () => {
    expect(isNetworkError(netErr('ECONNREFUSED'))).toBe(true)
    expect(isNetworkError(new TypeError('fetch failed'))).toBe(true)
    expect(isNetworkError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(false)
    expect(isNetworkError(new Error('Ollama HTTP 500: boom'))).toBe(false)
  })
})

describe('OllamaPool', () => {
  it('uses the first healthy URL in order and logs the change', async () => {
    const log = vi.fn()
    const { p } = pool(new Set([A, B]), { log })
    expect(await p.probe()).toBe(A)
    expect(log).toHaveBeenCalledWith(`ollama active: ${A}`)
  })

  it('skips a dead primary', async () => {
    const { p } = pool(new Set([B]))
    expect(await p.probe()).toBe(B)
    expect(p.status()).toMatchObject({ ok: true, active: B })
  })

  it('fails a request over to the next URL on a network error', async () => {
    const up = new Set([A, B])
    const { p } = pool(up)
    await p.probe()
    up.delete(A)
    const fn = vi.fn(async (base: string) => {
      if (base === A) throw netErr('ECONNREFUSED')
      return `ok via ${base}`
    })
    expect(await p.withOllama(fn)).toBe(`ok via ${B}`)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(p.status().active).toBe(B)
  })

  it('does not fail over on non-network errors', async () => {
    const { p } = pool(new Set([A, B]))
    const fn = vi.fn(async () => { throw new Error('Ollama HTTP 404: model not found') })
    await expect(p.withOllama(fn)).rejects.toThrow('model not found')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('reports a truthful reason when every URL is down', async () => {
    const log = vi.fn()
    const { p } = pool(new Set(), { log })
    await expect(p.withOllama(async () => 'x')).rejects.toBeInstanceOf(OllamaUnavailableError)
    const s = await p.health()
    expect(s.ok).toBe(false)
    expect(s.reason).toContain(A)
    expect(s.reason).toContain(B)
    expect(p.knownDown()).toBe(true)
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^ollama UNREACHABLE/))
  })

  it('caches health for one probe interval, then re-probes', async () => {
    let t = 1_000
    const { p, fetchImpl } = pool(new Set([A]), { now: () => t })
    await p.health()
    await p.health()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    t += 15_000
    await p.health()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('returns to the primary once it recovers', async () => {
    const up = new Set([B])
    const { p } = pool(up)
    expect(await p.probe()).toBe(B)
    up.add(A)
    expect(await p.probe()).toBe(A)
  })

  it('shares one probe between concurrent callers', async () => {
    const { p, fetchImpl } = pool(new Set([A]))
    await Promise.all([p.health(), p.health(), p.resolve()])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('JobWaiters', () => {
  it('keeps a constant listener count and settles waiters', async () => {
    const ev = new EventEmitter()
    const w = new JobWaiters(ev as any, async () => null)
    const results = Promise.all(Array.from({ length: 50 }, (_, i) => w.wait<string>(`j${i}`, 10_000)))
    expect(ev.listenerCount('completed')).toBe(1)
    expect(ev.listenerCount('failed')).toBe(1)
    for (let i = 0; i < 50; i++) ev.emit('completed', { jobId: `j${i}`, returnvalue: `r${i}` })
    expect((await results)[49]).toBe('r49')
    expect(w.size).toBe(0)
  })

  it('rejects on failure', async () => {
    const ev = new EventEmitter()
    const w = new JobWaiters(ev as any, async () => null)
    const p = w.wait('j1', 10_000)
    ev.emit('failed', { jobId: 'j1', failedReason: 'Ollama is not reachable' })
    await expect(p).rejects.toThrow('Ollama is not reachable')
  })

  it('times out and drops the waiter, checking the final state once', async () => {
    vi.useFakeTimers()
    try {
      const ev = new EventEmitter()
      const lookup = vi.fn(async () => null)
      const w = new JobWaiters(ev as any, lookup)
      const p = w.wait('j1', 1_000)
      const check = expect(p).rejects.toThrow('did not finish within 1000ms')
      await vi.advanceTimersByTimeAsync(1_000)
      await check
      expect(lookup).toHaveBeenCalledWith('j1')
      expect(w.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves from the stored result when the finish event was missed', async () => {
    vi.useFakeTimers()
    try {
      const w = new JobWaiters(new EventEmitter() as any, async () => ({ state: 'completed' as const, value: 42 }))
      const p = w.wait('j1', 500)
      await vi.advanceTimersByTimeAsync(500)
      expect(await p).toBe(42)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('razer circuit breaker', () => {
  function probe(results: (string | null)[], opts: { failures?: number; configured?: boolean; now?: () => number } = {}) {
    let i = 0
    const check = vi.fn(async () => results[Math.min(i++, results.length - 1)])
    const log = vi.fn()
    return { p: new BackendProbe('sd', check, { failures: opts.failures ?? 2, configured: opts.configured, now: opts.now, log }), check, log }
  }

  it('opens only after N failed probes in a row and closes on the first good one', async () => {
    const { p, log } = probe(['down', 'down', null])
    expect(p.isOpen()).toBe(false)
    expect(p.status()).toMatchObject({ ok: false, open: false, checkedAt: null, reason: 'not probed yet' })
    await p.probe()
    expect(p.isOpen()).toBe(false)
    await p.probe()
    expect(p.isOpen()).toBe(true)
    expect(p.status()).toMatchObject({ configured: true, ok: false, open: true, reason: 'down' })
    expect(log).toHaveBeenCalledWith('sd UNAVAILABLE: down (breaker open, routing skips razer)')
    await p.probe()
    expect(p.isOpen()).toBe(false)
    expect(log).toHaveBeenLastCalledWith('sd recovered (breaker closed)')
  })

  it('a check that throws counts as a failed probe', async () => {
    const p = new BackendProbe('x', async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) }, { failures: 1, log: () => {} })
    expect(await p.probe()).toBe(false)
    expect(p.status().reason).toBe('ECONNREFUSED')
  })

  it('an unconfigured backend is never probed and never open', async () => {
    const { p, check } = probe(['down'], { configured: false, failures: 1 })
    expect(await p.probe()).toBe(false)
    p.start()
    expect(check).not.toHaveBeenCalled()
    expect(p.status()).toMatchObject({ configured: false, open: false, reason: 'not configured' })
  })

  it('re-probes on a failed call, rate-limited, and shares a running probe', async () => {
    let t = 0
    const { p, check } = probe(['down'], { now: () => t })
    p.recordFailure()
    p.recordFailure()
    await new Promise(r => setTimeout(r, 0))
    expect(check).toHaveBeenCalledTimes(1)
    t += 2_000
    p.recordFailure()
    await Promise.all([p.probe(), p.probe()])
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('guard re-probes on outages only and always rethrows', async () => {
    const { p, check } = probe([null])
    await expect(p.guard(async () => { throw new ProviderError('razer', 'HTTP 400 bad prompt', 400) })).rejects.toThrow('bad prompt')
    expect(check).not.toHaveBeenCalled()
    await expect(p.guard(async () => { throw new ProviderError('razer', 'This operation was aborted') })).rejects.toThrow('aborted')
    expect(check).toHaveBeenCalledTimes(1)
    expect(await p.guard(async () => 'ok')).toBe('ok')
  })

  it('start probes now and on the interval; stop ends it', async () => {
    vi.useFakeTimers()
    try {
      const { p, check } = probe([null])
      p.start()
      p.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(check).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(15_000)
      expect(check).toHaveBeenCalledTimes(2)
      p.stop()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(check).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('classifies outages', () => {
    expect(isOutage(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))).toBe(true)
    expect(isOutage(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe(true)
    expect(isOutage(new ProviderError('razer', 'HTTP 503 loading', 503))).toBe(true)
    expect(isOutage(new ProviderError('razer', 'HTTP 500 oom', 500))).toBe(false)
    expect(isOutage(new ProviderError('razer', 'fetch failed'))).toBe(true)
    expect(isOutage(new Error('connect ETIMEDOUT 100.82.208.8:7860'))).toBe(true)
    expect(isOutage(new Error('no images returned'))).toBe(false)
    expect(isOutage(null)).toBe(false)
  })

  it('httpCheck reports status, timeout and network failures', async () => {
    const f = (impl: () => Promise<Response>) => impl as unknown as typeof fetch
    expect(await httpCheck('http://sd/health', 100, f(async () => new Response('{}')))()).toBeNull()
    expect(await httpCheck('http://sd/health', 100, f(async () => new Response('', { status: 502 })))()).toBe('HTTP 502')
    expect(await httpCheck('http://sd/health', 100, f(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }) }))()).toBe('timeout 100ms')
    expect(await httpCheck('http://sd/health', 100, f(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'EHOSTUNREACH' } }) }))()).toBe('EHOSTUNREACH')
  })

  it('maps capabilities to backends and reports every backend', async () => {
    const { p: sd } = probe(['down'], { failures: 1 })
    await sd.probe()
    const { p: ocr } = probe([null])
    const ollama = poolSource({ status: () => ({ ok: true, active: A, urls: [A], checkedAt: 1 }), knownDown: () => false })
    const m = new RazerHealthMonitor({ ollama, sd, paddleocr: ocr })
    expect(RAZER_BACKEND).toEqual({ text: 'ollama', vision: 'ollama', embed: 'ollama', image: 'sd', ocr: 'paddleocr' })
    expect([m.up('text'), m.up('embed'), m.up('image'), m.up('ocr')]).toEqual([true, true, false, true])
    expect(m.report()).toMatchObject({
      ollama: { configured: true, ok: true, open: false, checkedAt: 1 },
      sd: { ok: false, open: true, reason: 'down' },
      paddleocr: { ok: false, open: false },
    })
  })

  it('guardedMedia passes calls through the breaker', async () => {
    const { p, check } = probe([null])
    const inner: MediaProvider = { name: 'razer', configured: () => true, generateImage: vi.fn(async () => { throw new ProviderError('razer', 'fetch failed') }) }
    const g = guardedMedia(inner, p)
    expect(g.configured()).toBe(true)
    await expect(g.generateImage!({ prompt: 'x', width: 64, height: 64, n: 1, quality: 'draft' })).rejects.toThrow('fetch failed')
    expect(check).toHaveBeenCalledTimes(1)
    expect(guardedMedia({ name: 'razer', configured: () => false }, p).generateImage).toBeUndefined()
  })
})
