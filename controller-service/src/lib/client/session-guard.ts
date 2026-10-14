import { BIND_ENDPOINT, PROOF_HEADER } from '@/lib/auth/session-binding-shared'

// Browser half of key-bound sessions (see src/lib/session-binding.ts). The signing key is created
// non-extractable and kept in IndexedDB: page code and DevTools can use it to sign here, but
// nothing can read it out, so it cannot follow a copied cookie into another browser.
// Everything in this file fails quietly: a problem here must never break a page or a request.

const DB_NAME = '_app'
const STORE = 'kv'
const KEY_ID = 'k1'
const REFRESH_MARGIN_MS = 60_000
const IDLE_RECHECK_MS = 10 * 60_000
// How long a page-load API call waits for the guard to (re)bind before going out anyway. On a fast
// local loop the bind finishes in milliseconds; in production the POST to the bind endpoint can
// exceed this, so calls go out before the cookie exists. NEXT_PUBLIC_BIND_WAIT_MS lets a dev shrink
// it (e.g. 0) to reproduce that production race locally. Never set in production.
const BIND_WAIT_MS = Number(process.env.NEXT_PUBLIC_BIND_WAIT_MS ?? 3000)
const STATE_KEY = '_app_b'
const AUTH_PATH = /(login|signin|sign-in|signup|otp|verify|google|callback|mfa|logout|\/auth\/)/i

let keyPair: CryptoKeyPair | null = null
let publicJwk: JsonWebKey | null = null
let clockOffset = 0
let nextRefreshAt = 0
let boundCount = 0
let binding: Promise<void> | null = null

// Shared by every tab of the origin, so a page load can skip the bind call while the cookie a
// sibling tab (or the previous page) earned is still good.
function remember(): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ u: nextRefreshAt, b: boundCount, o: clockOffset }))
  } catch {
    /* private mode */
  }
}

function recall(): boolean {
  try {
    const v = JSON.parse(localStorage.getItem(STATE_KEY) || 'null')
    const left = typeof v?.u === 'number' ? v.u - Date.now() : 0
    if (left <= 0 || left > IDLE_RECHECK_MS) return false
    nextRefreshAt = v.u
    boundCount = typeof v.b === 'number' ? v.b : 0
    clockOffset = typeof v.o === 'number' ? v.o : 0
    return true
  } catch {
    return false
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = run(tx.objectStore(STORE))
        req.onsuccess = () => resolve(req.result as T)
        req.onerror = () => reject(req.error)
      })
  )
}

async function loadKey(): Promise<void> {
  const existing = await idb<CryptoKeyPair | undefined>('readonly', s => s.get(KEY_ID))
  if (existing?.privateKey) {
    keyPair = existing
  } else {
    const fresh = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
    // add() refuses to overwrite: if another tab created a key first, use that one, so every tab
    // of this origin signs with the single key the server has on file.
    try {
      await idb('readwrite', s => s.add(fresh, KEY_ID))
      keyPair = fresh
    } catch {
      keyPair = (await idb<CryptoKeyPair | undefined>('readonly', s => s.get(KEY_ID))) ?? fresh
    }
  }
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  publicJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (const b of arr) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function makeProof(method: string, path: string): Promise<string | null> {
  if (!keyPair) return null
  const ts = Date.now() + clockOffset
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)))
  const message = new TextEncoder().encode(`${method.toUpperCase()}\n${path}\n${ts}\n${nonce}`)
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, message)
  return `${ts.toString(36)}.${nonce}.${b64url(sig)}`
}

function bind(rawFetch: typeof fetch, retry = true): Promise<void> {
  if (binding) return binding
  binding = (async () => {
    try {
      const proof = await makeProof('POST', BIND_ENDPOINT)
      if (!proof) return
      const res = await rawFetch(BIND_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', [PROOF_HEADER]: proof },
        body: JSON.stringify({ k: publicJwk }),
      })
      const data = await res.json().catch(() => null)
      if (typeof data?.now === 'number') clockOffset = data.now - Date.now()
      if (res.status === 409 && retry) {
        binding = null
        return bind(rawFetch, false)
      }
      boundCount = typeof data?.bound === 'number' ? data.bound : 0
      // Nothing to keep alive when no session is bound here, so stop asking every minute.
      nextRefreshAt =
        typeof data?.exp === 'number'
          ? data.exp - clockOffset - REFRESH_MARGIN_MS
          : Date.now() + (res.ok ? IDLE_RECHECK_MS : REFRESH_MARGIN_MS)
      remember()
    } catch {
      nextRefreshAt = Date.now() + REFRESH_MARGIN_MS
    } finally {
      binding = null
    }
  })()
  return binding
}

export function installSessionGuard(): void {
  if (typeof window === 'undefined') return
  const w = window as unknown as { __sg?: boolean }
  if (w.__sg || !window.indexedDB || !window.crypto?.subtle) return
  w.__sg = true

  const rawFetch = window.fetch.bind(window)
  const capped = (p: Promise<void>): Promise<void> =>
    Promise.race([p.catch(() => {}), new Promise<void>(resolve => setTimeout(resolve, BIND_WAIT_MS))])
  const current = recall()
  let ready = capped(loadKey().then(() => (current ? undefined : bind(rawFetch))))

  const sign = async (input: RequestInfo | URL, init: RequestInit | undefined, method: string, path: string) => {
    const proof = await makeProof(method, path)
    if (!proof) return init
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set(PROOF_HEADER, proof)
    return { ...init, headers }
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let apiPath: string | null = null
    let method = 'GET'
    try {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const url = new URL(raw, window.location.href)
      if (url.origin === window.location.origin && url.pathname !== BIND_ENDPOINT) {
        // Page-data requests carry no proof but still need a live cookie, so they wait too.
        await ready
        if (Date.now() > nextRefreshAt) await capped(bind(rawFetch))
        if (url.pathname.startsWith('/api/')) {
          apiPath = url.pathname
          method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
          init = await sign(input, init, method, apiPath)
        }
      }
    } catch {
      /* send the request untouched */
    }

    const replayable = !(input instanceof Request) && !(init?.body instanceof ReadableStream)
    let res = await rawFetch(input, init)
    if (!apiPath) return res
    const authCall = AUTH_PATH.test(apiPath)

    // A refusal can just mean the cookie lapsed in a tab that was asleep: re-earn it and try once
    // more. A browser without the key cannot, so it stays refused.
    if (res.status === 401 && replayable && !authCall) {
      try {
        await capped(bind(rawFetch))
        if (boundCount > 0) res = await rawFetch(input, await sign(input, init, method, apiPath))
      } catch {
        /* keep the original response */
      }
    }

    // A login or logout just changed which sessions exist. Later calls wait for the new binding
    // instead of racing it.
    if (res.ok && method !== 'GET' && authCall) ready = capped(bind(rawFetch))
    return res
  }

  const tick = () => {
    if (document.visibilityState === 'visible' && Date.now() > nextRefreshAt) bind(rawFetch).catch(() => {})
  }
  document.addEventListener('visibilitychange', tick)
  window.setInterval(tick, 30_000)
}
