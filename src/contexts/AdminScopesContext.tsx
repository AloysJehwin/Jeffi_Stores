'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { hasScope } from '@/lib/scopes'

interface AdminScopes {
  role: string
  scopes: string[]
}

const Ctx = createContext<AdminScopes>({ role: '', scopes: [] })

export function AdminScopesProvider({ role, scopes, children }: AdminScopes & { children: ReactNode }) {
  return <Ctx.Provider value={{ role, scopes }}>{children}</Ctx.Provider>
}

/**
 * Whether the signed-in admin may perform a write. The endpoints enforce this themselves — this
 * is so an action a member cannot take is not offered to them in the first place, rather than
 * failing with a 403 when they click it.
 */
export function useCanWrite(scope: string): boolean {
  const { role, scopes } = useContext(Ctx)
  return hasScope(role, scopes, scope.endsWith(':write') ? scope : `${scope}:write`)
}

/** True when the admin holds this exact scope. Session scopes are already narrowed to what the
 * tenant's plan sells, so this also hides features the plan does not include. */
export function useHasScope(scope: string): boolean {
  const { role, scopes } = useContext(Ctx)
  return hasScope(role, scopes, scope)
}

/** Renders its children only when the admin holds the write scope. */
export function RequireWrite({ scope, children, fallback = null }: {
  scope: string
  children: ReactNode
  fallback?: ReactNode
}) {
  return useCanWrite(scope) ? <>{children}</> : <>{fallback}</>
}
