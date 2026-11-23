import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'

// A real RSA key so createSign() runs for real (no crypto mock). The JWT signature
// goes to a mocked fetch, so we never verify it — any valid private key works.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const SA = {
  project_id: 'demo-proj',
  client_email: 'svc@demo.iam.gserviceaccount.com',
  // Stored with literal \n, as the env var carries them — exercises the un-escaping.
  private_key: privateKey.replace(/\n/g, '\\n'),
}

function saJson(over: Record<string, unknown> = {}) {
  return JSON.stringify({ ...SA, ...over })
}

// Fresh module per test: the module caches parsed SA / access token / pending promise
// in module-level state, so each test re-imports to start clean.
async function load(env: Record<string, string | undefined> = {}) {
  vi.resetModules()
  for (const k of ['FCM_SERVICE_ACCOUNT_JSON']) delete process.env[k]
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  return import('../src/index.ts')
}

// fetch mock helpers --------------------------------------------------------
function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// A fetch that answers the OAuth token endpoint, then delegates FCM sends to `onSend`.
function wireFetch(onSend: (url: string, init: RequestInit) => Response, tokenRes?: Response) {
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    if (String(url).includes('oauth2.googleapis.com') || String(url).includes('/token')) {
      return tokenRes ?? jsonRes(200, { access_token: 'tok-abc', expires_in: 3600 })
    }
    return onSend(String(url), init)
  })
}

// ---------------------------------------------------------------------------
describe('PUSH_CATEGORIES', () => {
  it('exposes the four categories', async () => {
    const { PUSH_CATEGORIES } = await load()
    expect([...PUSH_CATEGORIES]).toEqual(['orders', 'account', 'offers', 'price_alerts'])
  })
})

describe('pushConfigured / serviceAccount parsing', () => {
  it('false when env var missing', async () => {
    const { pushConfigured } = await load({ FCM_SERVICE_ACCOUNT_JSON: undefined })
    expect(pushConfigured()).toBe(false)
  })

  it('false when env var is blank/whitespace', async () => {
    const { pushConfigured } = await load({ FCM_SERVICE_ACCOUNT_JSON: '   ' })
    expect(pushConfigured()).toBe(false)
  })

  it('true for raw JSON object', async () => {
    const { pushConfigured } = await load({ FCM_SERVICE_ACCOUNT_JSON: saJson() })
    expect(pushConfigured()).toBe(true)
  })

  it('true for base64-encoded JSON', async () => {
    const b64 = Buffer.from(saJson(), 'utf8').toString('base64')
    const { pushConfigured } = await load({ FCM_SERVICE_ACCOUNT_JSON: b64 })
    expect(pushConfigured()).toBe(true)
  })

  it('false when a required field is missing', async () => {
    const { pushConfigured } = await load({ FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'p', client_email: 'e' }) })
    expect(pushConfigured()).toBe(false)
  })

  it('false on malformed JSON (parse throws)', async () => {
    const { pushConfigured } = await load({ FCM_SERVICE_ACCOUNT_JSON: '{not json' })
    expect(pushConfigured()).toBe(false)
  })

  it('false on garbage base64 (not starting with {)', async () => {
    const { pushConfigured } = await load({ FCM_SERVICE_ACCOUNT_JSON: 'not-base64-and-not-json!!!' })
    expect(pushConfigured()).toBe(false)
  })

  it('caches the parse: repeated calls with same raw reuse result', async () => {
    const { pushConfigured } = await load({ FCM_SERVICE_ACCOUNT_JSON: saJson() })
    expect(pushConfigured()).toBe(true)
    // Second call hits the parsed?.raw === raw cache branch.
    expect(pushConfigured()).toBe(true)
  })
})

describe('sendPush — not configured', () => {
  it('returns a per-token failure for every token when env missing', async () => {
    const { sendPush } = await load({ FCM_SERVICE_ACCOUNT_JSON: undefined })
    const res = await sendPush(['a', 'b'], { title: 't', body: 'b', category: 'orders' })
    expect(res).toHaveLength(2)
    expect(res.every(r => !r.ok && !r.invalidToken)).toBe(true)
    expect(res[0].error).toMatch(/not configured/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('dedups and drops empty / non-string tokens', async () => {
    const { sendPush } = await load({ FCM_SERVICE_ACCOUNT_JSON: undefined })
    const res = await sendPush(['x', 'x', '', null as any, 5 as any, 'y'], { title: 't', body: 'b', category: 'offers' })
    expect(res.map(r => r.token)).toEqual(['x', 'y'])
  })
})

describe('sendPush — auth failure', () => {
  it('maps a token-mint failure to a per-token error, no FCM send', async () => {
    const { sendPush } = await load({ FCM_SERVICE_ACCOUNT_JSON: saJson() })
    fetchMock.mockImplementation(async () => jsonRes(400, { error: 'invalid_grant', error_description: 'bad jwt' }))
    const res = await sendPush(['t1'], { title: 't', body: 'b', category: 'orders' })
    expect(res[0].ok).toBe(false)
    expect(res[0].error).toMatch(/FCM auth failed: bad jwt/)
    expect(res[0].invalidToken).toBe(false)
    // Only the token call(s) happened — no messages:send.
    expect(fetchMock.mock.calls.every(c => String(c[0]).includes('oauth2'))).toBe(true)
  })

  it('auth failure falls back to error then HTTP status', async () => {
    const { sendPush } = await load({ FCM_SERVICE_ACCOUNT_JSON: saJson() })
    fetchMock.mockImplementation(async () => jsonRes(500, { error: 'server_err' }))
    const res = await sendPush(['t1'], { title: 't', body: 'b', category: 'orders' })
    expect(res[0].error).toMatch(/FCM auth failed: server_err/)
  })

  it('auth failure with no error body falls back to HTTP status', async () => {
    const { sendPush } = await load({ FCM_SERVICE_ACCOUNT_JSON: saJson() })
    fetchMock.mockImplementation(async () => ({ ok: false, status: 503, json: async () => { throw new Error('no body') } } as unknown as Response))
    const res = await sendPush(['t1'], { title: 't', body: 'b', category: 'orders' })
    expect(res[0].error).toMatch(/FCM auth failed: HTTP 503/)
  })
})

describe('sendPush — successful send & payload shaping', () => {
  it('sends one message per token and returns messageId', async () => {
    const { sendPush } = await load({ FCM_SERVICE_ACCOUNT_JSON: saJson() })
    wireFetch(() => jsonRes(200, { name: 'projects/demo/messages/9' }))
    const res = await sendPush(['t1', 't2'], { title: 'Hi', body: 'There', category: 'orders' })
    expect(res).toEqual([
      { token: 't1', ok: true, messageId: 'projects/demo/messages/9', invalidToken: false },
      { token: 't2', ok: true, messageId: 'projects/demo/messages/9', invalidToken: false },
    ])
    // URL encodes the project id, bearer token present.
    const send = fetchMock.mock.calls.find(c => String(c[0]).includes('messages:send'))!
    expect(String(send[0])).toContain('/projects/demo-proj/messages:send')
    expect((send[1] as any).headers.authorization).toBe('Bearer tok-abc')
  })

  it('shapes HIGH-priority payload with image, link, data (null dropped), collapseKey', async () => {
    const { sendPush } = await load({ FCM_SERVICE_ACCOUNT_JSON: saJson() })
    let sent: any
    wireFetch((_u, init) => {
      sent = JSON.parse(String((init as any).body))
      return jsonRes(200, { name: 'm1' })
    })
    await sendPush(['t1'], {
      title: 'Order shipped',
      body: 'On the way',
      image: 'https://img/x.png',
      link: '/orders/1',
      category: 'orders',
      collapseKey: 'ck-1',
      data: { orderId: 42, flag: true, gone: null, skip: undefined },
    })
    expect(sent.message.notification).toEqual({ title: 'Order shipped', body: 'On the way', image: 'https://img/x.png' })
    expect(sent.message.data).toEqual({ orderId: '42', flag: 'true', link: '/orders/1', category: 'orders' })
    expect(sent.message.android.priority).toBe('HIGH')
    expect(sent.message.android.collapse_key).toBe('ck-1')
    expect(sent.message.android.notification).toEqual({ channel_id: 'orders', tag: 'ck-1' })
  })

  it('NORMAL priority for non-high category, no image/link/collapse keys', async () => {
    const { sendPush } = await load({ FCM_SERVICE_ACCOUNT_JSON: saJson() })
    let sent: any
    wireFetch((_u, init) => {
      sent = JSON.parse(String((init as any).body))
      return jsonRes(200, { name: 'm2' })
    })
    await sendPush(['t1'], { title: 'Sale', body: '20% off', category: 'offers' })
    expect(sent.message.notification).toEqual({ title: 'Sale', body: '20% off' })
    expect(sent.message.data).toEqual({ category: 'offers' })
    expect(sent.message.android.priority).toBe('NORMAL')
    expect(sent.message.android).not.toHaveProperty('collapse_key')
    expect(sent.message.android.notification).toEqual({ channel_id: 'offers' })
  })

  it('reuses a single minted access token across many tokens (concurrency)', async () => {
    const { sendPush } = await load({ FCM_SERVICE_ACCOUNT_JSON: saJson() })
    wireFetch(() => jsonRes(200, { name: 'ok' }))
    const tokens = Array.from({ length: 40 }, (_, i) => `t${i}`)
    const res = await sendPush(tokens, { title: 't', body: 'b', category: 'account' })
    expect(res).toHaveLength(40)
    expect(res.every(r => r.ok)).toBe(true)
    // Exactly one token mint; 40 message sends.
    const tokenCalls = fetchMock.mock.calls.filter(c => String(c[0]).includes('oauth2'))
    const sendCalls = fetchMock.mock.calls.filter(c => String(c[0]).includes('messages:send'))
    expect(tokenCalls).toHaveLength(1)
    expect(sendCalls).toHaveLength(40)
  })
})

describe('sendOne — error classification', () => {
  async function send(fcmStatus: number, fcmBody: unknown) {
    const { sendPush } = await load({ FCM_SERVICE_ACCOUNT_JSON: saJson() })
    wireFetch(() => jsonRes(fcmStatus, fcmBody))
    const [r] = await sendPush(['t1'], { title: 't', body: 'b', category: 'orders' })
    return r
  }

  it('UNREGISTERED → invalidToken true', async () => {
    const r = await send(404, { error: { status: 'NOT_FOUND', message: 'gone', details: [{ errorCode: 'UNREGISTERED' }] } })
    expect(r.ok).toBe(false)
    expect(r.invalidToken).toBe(true)
    expect(r.error).toBe('UNREGISTERED: gone')
  })

  it('SENDER_ID_MISMATCH → invalidToken true', async () => {
    const r = await send(403, { error: { details: [{ errorCode: 'SENDER_ID_MISMATCH' }] } })
    expect(r.invalidToken).toBe(true)
    expect(r.error).toBe('SENDER_ID_MISMATCH')
  })

  it('INVALID_ARGUMENT on a token field → invalidToken true (fieldViolations)', async () => {
    const r = await send(400, {
      error: {
        message: 'bad',
        details: [
          { errorCode: 'INVALID_ARGUMENT' },
          { fieldViolations: [{ field: 'message.token' }] },
        ],
      },
    })
    expect(r.invalidToken).toBe(true)
    expect(r.error).toBe('INVALID_ARGUMENT: bad')
  })

  it('INVALID_ARGUMENT flagged by "registration token" message → invalidToken true', async () => {
    const r = await send(400, { error: { message: 'The registration token is not valid', details: [{ errorCode: 'INVALID_ARGUMENT' }] } })
    expect(r.invalidToken).toBe(true)
  })

  it('INVALID_ARGUMENT not about token → invalidToken false', async () => {
    const r = await send(400, { error: { message: 'bad image url', details: [{ errorCode: 'INVALID_ARGUMENT' }] } })
    expect(r.invalidToken).toBe(false)
    expect(r.error).toBe('INVALID_ARGUMENT: bad image url')
  })

  it('falls back to e.status when no errorCode in details', async () => {
    const r = await send(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'slow down' } })
    expect(r.error).toBe('RESOURCE_EXHAUSTED: slow down')
    expect(r.invalidToken).toBe(false)
  })

  it('falls back to HTTP_<status> when neither errorCode nor status present', async () => {
    const r = await send(500, {})
    expect(r.error).toBe('HTTP_500')
    expect(r.invalidToken).toBe(false)
  })

  it('truncates very long errors to 300 chars', async () => {
    const r = await send(400, { error: { status: 'X', message: 'z'.repeat(500) } })
    expect(r.error.length).toBe(300)
  })
})

describe('sendOne — 401 retry and network errors', () => {
  it('retries once on 401 with a force-minted token, then succeeds', async () => {
    const { sendPush } = await load({ FCM_SERVICE_ACCOUNT_JSON: saJson() })
    let sendAttempt = 0
    let tokenMints = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('oauth2')) {
        tokenMints++
        return jsonRes(200, { access_token: `tok-${tokenMints}`, expires_in: 3600 })
      }
      sendAttempt++
      if (sendAttempt === 1) return jsonRes(401, { error: { status: 'UNAUTHENTICATED' } })
      return jsonRes(200, { name: 'after-retry' })
    })
    const [r] = await sendPush(['t1'], { title: 't', body: 'b', category: 'orders' })
    expect(r.ok).toBe(true)
    expect(r.messageId).toBe('after-retry')
    expect(sendAttempt).toBe(2)
    expect(tokenMints).toBe(2) // initial + forced re-mint
  })

  it('a 401 on the retry (attempt 1) is returned as a classified error', async () => {
    const { sendPush } = await load({ FCM_SERVICE_ACCOUNT_JSON: saJson() })
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('oauth2')) return jsonRes(200, { access_token: 'tok', expires_in: 3600 })
      return jsonRes(401, { error: { status: 'UNAUTHENTICATED', message: 'nope' } })
    })
    const [r] = await sendPush(['t1'], { title: 't', body: 'b', category: 'orders' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('UNAUTHENTICATED: nope')
  })

  it('a thrown fetch (network error) comes back as a per-token error', async () => {
    const { sendPush } = await load({ FCM_SERVICE_ACCOUNT_JSON: saJson() })
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('oauth2')) return jsonRes(200, { access_token: 'tok', expires_in: 3600 })
      throw new Error('socket hang up')
    })
    const [r] = await sendPush(['t1'], { title: 't', body: 'b', category: 'orders' })
    expect(r.ok).toBe(false)
    expect(r.invalidToken).toBe(false)
    expect(r.error).toBe('socket hang up')
  })
})

describe('accessToken caching across sendPush calls', () => {
  it('a second sendPush reuses the cached token (no second mint)', async () => {
    const mod = await load({ FCM_SERVICE_ACCOUNT_JSON: saJson() })
    wireFetch(() => jsonRes(200, { name: 'ok' }), jsonRes(200, { access_token: 'tok-cached', expires_in: 3600 }))
    await mod.sendPush(['a'], { title: 't', body: 'b', category: 'orders' })
    await mod.sendPush(['b'], { title: 't', body: 'b', category: 'orders' })
    const tokenCalls = fetchMock.mock.calls.filter(c => String(c[0]).includes('oauth2'))
    expect(tokenCalls).toHaveLength(1)
  })

  it('a near-expiry cached token is re-minted (not reused)', async () => {
    const mod = await load({ FCM_SERVICE_ACCOUNT_JSON: saJson() })
    // expires_in inside the 5-min skew window: the cache check `Date.now() < expiresAt - 5min`
    // is false, so the next sendPush mints again rather than reusing. Two calls → strictly
    // more than the single mint a healthy cache would produce.
    wireFetch(() => jsonRes(200, { name: 'ok' }), jsonRes(200, { access_token: 'tok', expires_in: 60 }))
    await mod.sendPush(['a'], { title: 't', body: 'b', category: 'orders' })
    const firstMints = fetchMock.mock.calls.filter(c => String(c[0]).includes('oauth2')).length
    await mod.sendPush(['b'], { title: 't', body: 'b', category: 'orders' })
    const totalMints = fetchMock.mock.calls.filter(c => String(c[0]).includes('oauth2')).length
    // The second call could not reuse the stale token, so it minted at least once more.
    expect(totalMints).toBeGreaterThan(firstMints)
  })

  it('honours a custom token_uri from the service account', async () => {
    const mod = await load({ FCM_SERVICE_ACCOUNT_JSON: saJson({ token_uri: 'https://custom.example/token' }) })
    wireFetch(() => jsonRes(200, { name: 'ok' }))
    await mod.sendPush(['a'], { title: 't', body: 'b', category: 'orders' })
    const custom = fetchMock.mock.calls.find(c => String(c[0]) === 'https://custom.example/token')
    expect(custom).toBeTruthy()
  })

  it('defaults expires_in to 3600 when the token endpoint omits it', async () => {
    const mod = await load({ FCM_SERVICE_ACCOUNT_JSON: saJson() })
    wireFetch(() => jsonRes(200, { name: 'ok' }), jsonRes(200, { access_token: 'tok' }))
    const [r] = await mod.sendPush(['a'], { title: 't', body: 'b', category: 'orders' })
    expect(r.ok).toBe(true)
  })
})
