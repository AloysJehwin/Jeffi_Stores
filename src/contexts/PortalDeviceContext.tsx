'use client'

import { createContext, useContext } from 'react'

// Server-detected device class for the portal surfaces (cert portal, staff notes). The shell
// decides once from the User-Agent so each surface can render a dedicated mobile or desktop
// component tree instead of one responsive layout.
const PortalDeviceContext = createContext<boolean>(false)

export function PortalDeviceProvider({ isMobile, children }: { isMobile: boolean; children: React.ReactNode }) {
  return <PortalDeviceContext.Provider value={isMobile}>{children}</PortalDeviceContext.Provider>
}

export function useIsMobile(): boolean {
  return useContext(PortalDeviceContext)
}
