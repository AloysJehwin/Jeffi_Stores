import { vi } from 'vitest'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { AdminScopesProvider } from '@/contexts/AdminScopesContext'

// Shared helpers for the marketplace console tests: a scopes wrapper (administrator = may write,
// staff with no scopes = read-only) and a URL-routed fetch stub so no test touches the network.

export function renderAs(ui: ReactElement, who: 'writer' | 'reader' = 'writer') {
  const role = who === 'writer' ? 'administrator' : 'staff'
  return render(
    <AdminScopesProvider role={role} scopes={[]}>
      {ui}
    </AdminScopesProvider>
  )
}

export const res = (body: unknown = {}, ok = true, headers: Record<string, string> = {}) => ({
  ok,
  status: ok ? 200 : 400,
  json: async () => body,
  blob: async () => new Blob(['x']),
  headers: new Headers(headers),
})

type Handler = (url: string, init?: RequestInit) => unknown
export type Routes = [string | RegExp, Handler | unknown][]

/** Routes fetch by URL substring / regex; the first match wins. Returns the mock to assert calls on. */
export function routeFetch(routes: Routes) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    for (const [match, h] of routes) {
      const hit = typeof match === 'string' ? url.includes(match) : match.test(url)
      if (hit) return typeof h === 'function' ? (h as Handler)(url, init) : h
    }
    return res({}, false)
  })
  vi.stubGlobal('fetch', fn as any)
  return fn
}

/** The parsed JSON body of the n-th call whose URL matches. */
export function bodyOf(fn: ReturnType<typeof routeFetch>, match: string | RegExp, nth = 0) {
  const calls = fn.mock.calls.filter(([u]) => (typeof match === 'string' ? u.includes(match) : match.test(u)))
  const init = calls[nth]?.[1] as RequestInit | undefined
  return init?.body ? JSON.parse(String(init.body)) : undefined
}

export function callsTo(fn: ReturnType<typeof routeFetch>, match: string | RegExp) {
  return fn.mock.calls.filter(([u]) => (typeof match === 'string' ? u.includes(match) : match.test(u)))
}

/** DataTable renders only the layout that matches the viewport; make it the wide (table) one. */
export function stubWide(wide = true) {
  const mm = (q: string) => ({ matches: wide, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })
  vi.stubGlobal('matchMedia', mm as any)
  ;(window as any).matchMedia = mm
}
