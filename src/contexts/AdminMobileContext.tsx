'use client'
import { createContext, useContext } from 'react'

export const AdminMobileContext = createContext<boolean>(false)

export function useIsMobileAdmin(): boolean {
  return useContext(AdminMobileContext)
}
