'use client'
import { AdminMobileContext } from './AdminMobileContext'

export function AdminMobileProvider({ isMobile, children }: { isMobile: boolean; children: React.ReactNode }) {
  return <AdminMobileContext.Provider value={isMobile}>{children}</AdminMobileContext.Provider>
}
