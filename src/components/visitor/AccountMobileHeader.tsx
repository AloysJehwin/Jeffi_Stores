'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { navItems } from '@/components/visitor/AccountSidebar'

export default function AccountMobileHeader() {
  const { user } = useAuth()
  const pathname = usePathname()

  if (!user) return null

  const initials = `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() || 'U'

  return (
    <>
      <div className="lg:hidden bg-accent-500 pt-8 pb-16 px-4">
        <h1 className="text-lg font-semibold text-white/80 mb-4">My Account</h1>
        <div className="flex items-center gap-4">
          <Link href="/account" className="relative w-16 h-16 rounded-full overflow-hidden flex-shrink-0 block">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.firstName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-white/20 flex items-center justify-center text-2xl font-bold text-white">
                {initials}
              </div>
            )}
          </Link>
          <div>
            <p className="text-xl font-bold text-white">{user.firstName} {user.lastName}</p>
            <p className="text-sm text-white/70 mt-0.5">{user.email}</p>
          </div>
        </div>
      </div>

      <div className="lg:hidden relative z-10 mx-4 -mt-8 mb-4">
        <div className="bg-surface-elevated rounded-xl shadow-md border border-border-default overflow-hidden">
          <div className="flex">
            {navItems.map((item) => {
              const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors border-b-2 ${
                    isActive
                      ? 'text-accent-600 border-accent-500 dark:text-accent-400'
                      : 'text-foreground-muted border-transparent'
                  }`}
                >
                  <span className={isActive ? 'text-accent-500' : 'text-foreground-muted'}>{item.icon}</span>
                  <span className="leading-tight text-center" style={{ fontSize: '10px' }}>{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
