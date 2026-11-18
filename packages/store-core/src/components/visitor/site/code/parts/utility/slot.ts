import * as React from 'react'
import type { ReactNode } from 'react'

// Request-scoped, like the product parts: a working page's route (sign in, account, wishlist…) puts its working
// component here before its Site Builder page renders, and the AI design's core part (SignInForm, AccountPage…) draws
// it. The first part placed takes it, so a part placed twice never draws two forms.

type Box = { parts: Map<string, ReactNode> }
// React's per-request cache (the App Router's React); a plain module box where it is missing (unit tests).
const reactCache = (React as unknown as { cache?: <F extends (...a: never[]) => unknown>(fn: F) => F }).cache
const fallback: Box = { parts: new Map() }
const slot: () => Box = typeof reactCache === 'function' ? reactCache((): Box => ({ parts: new Map() })) : () => fallback

export function setPageCore(part: string, node: ReactNode) {
  slot().parts.set(part, node)
}

/** The working component the route put up for `part`, once; undefined when it has none or it was already drawn. */
export function takePageCore(part: string): ReactNode | undefined {
  const box = slot()
  if (!box.parts.has(part)) return undefined
  const node = box.parts.get(part)
  box.parts.delete(part)
  return node
}
