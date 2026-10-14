'use client'

import { BusinessAccountNavBar } from '@/components/business/AccountSidebar'

export default function BusinessAccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)]">
      <BusinessAccountNavBar />
      <div className="flex-1">{children}</div>
    </div>
  )
}
