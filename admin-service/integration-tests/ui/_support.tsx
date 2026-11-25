import type { ReactNode } from 'react'
import { AdminScopesProvider } from '@/contexts/AdminScopesContext'

export function asAdmin(ui: ReactNode, scopes: string[] = []) {
  return <AdminScopesProvider role="administrator" scopes={scopes}>{ui}</AdminScopesProvider>
}
export function asMember(ui: ReactNode, scopes: string[] = []) {
  return <AdminScopesProvider role="staff" scopes={scopes}>{ui}</AdminScopesProvider>
}
