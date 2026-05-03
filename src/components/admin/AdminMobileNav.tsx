'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'

interface NavLink {
  href: string
  label: string
  mobileOnly?: boolean
  group?: string
}

interface AdminMobileNavProps {
  navLinks: NavLink[]
  username: string
  role: string
}

export default function AdminMobileNav({ navLinks, username, role }: AdminMobileNavProps) {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    setIsOpen(false)
  }, [pathname])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  const scanLink = navLinks.find(l => l.href === '/admin/scan')
  const nonScanLinks = navLinks.filter(l => l.href !== '/admin/scan')
  const ungrouped = nonScanLinks.filter(l => !l.group)
  const groups = nonScanLinks.reduce<Record<string, NavLink[]>>((acc, l) => {
    if (l.group) {
      acc[l.group] = acc[l.group] || []
      acc[l.group].push(l)
    }
    return acc
  }, {})

  return (
    <>
      <button
        type="button"
        className="md:hidden p-2 text-gray-300 hover:text-white transition-colors"
        onClick={() => setIsOpen(true)}
        aria-label="Open navigation"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <div
        className={`fixed inset-0 z-50 bg-black/50 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setIsOpen(false)}
      />

      <div
        className={`fixed top-0 left-0 bottom-0 z-50 w-[80vw] max-w-[300px] bg-secondary-600 dark:bg-secondary-800 shadow-xl transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h2 className="text-lg font-bold text-white">Admin Panel</h2>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-2 text-gray-300 hover:text-white"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-4 py-3 text-sm text-gray-300 border-b border-white/10">
            {username} <span className="text-gray-400">({role})</span>
          </div>

          <nav className="flex flex-col p-3 gap-1 flex-1">
            {scanLink && (
              <a
                href={scanLink.href}
                className={`flex items-center gap-3 px-4 py-3.5 rounded-xl font-semibold transition-colors mb-1 ${
                  pathname === scanLink.href
                    ? 'bg-secondary-400/40 text-white'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
                </svg>
                QuickScan
              </a>
            )}
            {ungrouped.map(link => (
              <a
                key={link.href}
                href={link.href}
                className={`px-4 py-3 rounded-lg font-medium transition-colors ${
                  pathname === link.href || (link.href !== '/admin/dashboard' && pathname?.startsWith(link.href))
                    ? 'bg-primary-500/20 text-primary-400'
                    : 'text-gray-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                {link.label}
              </a>
            ))}
            {Object.entries(groups).map(([groupName, links]) => (
              <MobileNavGroup key={groupName} groupName={groupName} links={links} pathname={pathname} />
            ))}
          </nav>
        </div>
      </div>
    </>
  )
}

function MobileNavGroup({ groupName, links, pathname }: { groupName: string; links: NavLink[]; pathname: string | null }) {
  const isAnyActive = links.some(l => pathname === l.href || pathname?.startsWith(l.href))
  const [isOpen, setIsOpen] = useState(isAnyActive)

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-lg font-medium text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
      >
        <span>{groupName}</span>
        <svg
          className={`w-4 h-4 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="ml-4 flex flex-col gap-0.5 mt-0.5">
          {links.map(link => (
            <a
              key={link.href}
              href={link.href}
              className={`px-4 py-2.5 rounded-lg font-medium transition-colors ${
                pathname === link.href || pathname?.startsWith(link.href)
                  ? 'bg-primary-500/20 text-primary-400'
                  : 'text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              {link.label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
