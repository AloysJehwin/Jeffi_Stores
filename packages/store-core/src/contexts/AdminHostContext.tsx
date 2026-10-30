'use client'

import { createContext, useContext, type ReactNode } from 'react'

// Public hostname the admin shell was rendered for. ap() needs it on BOTH server and client
// renders — reading window.location on the client alone makes hrefs differ from SSR (hydration
// mismatch on admin-{slug} hosts).
const AdminHostContext = createContext<string>('')

export function AdminHostProvider({ host, children }: { host: string; children: ReactNode }) {
  return <AdminHostContext.Provider value={host}>{children}</AdminHostContext.Provider>
}

export const useAdminHost = () => useContext(AdminHostContext)
