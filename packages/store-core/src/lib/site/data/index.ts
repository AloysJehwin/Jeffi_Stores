import { AsyncLocalStorage } from 'node:async_hooks'
import * as React from 'react'
import { dbSiteData } from './db'

export * from './types'
export { dbSiteData } from './db'
export { sampleSiteData } from './sample'
export { money, stars } from './format'

import type { SiteData } from './types'

// Which catalogue code sections read. The live store by default; the onboarding preview swaps in a sample catalogue.
// React renders a server tree after the function that built it returns, so AsyncLocalStorage alone would lose the
// source for nested sections: runWithSiteData also pins it for the rest of the request (React's per-request cache),
// which is what a preview page wants. CodeSection also takes the source as a prop.

const storage = new AsyncLocalStorage<SiteData>()
type Box = { current: SiteData | null }
const reactCache = (React as unknown as { cache?: <F extends (...a: never[]) => unknown>(fn: F) => F }).cache
const requestBox: (() => Box) | null = typeof reactCache === 'function' ? reactCache((): Box => ({ current: null })) : null

const box = (): Box | null => {
  try {
    return requestBox?.() ?? null
  } catch {
    return null
  }
}

export function runWithSiteData<T>(src: SiteData, fn: () => Promise<T>): Promise<T> {
  const b = box()
  if (b) b.current = src
  return storage.run(src, fn)
}

let live: SiteData | null = null

export function siteData(): SiteData {
  return storage.getStore() ?? box()?.current ?? (live ??= dbSiteData())
}
