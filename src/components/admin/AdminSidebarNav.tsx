'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'

interface NavLink {
  href: string
  label: string
  group?: string
}

export default function AdminSidebarNav({ navLinks }: { navLinks: NavLink[] }) {
  const pathname = usePathname()

  const ungrouped = navLinks.filter(l => !l.group)
  const groups = navLinks.reduce<Record<string, NavLink[]>>((acc, l) => {
    if (l.group) {
      acc[l.group] = acc[l.group] || []
      acc[l.group].push(l)
    }
    return acc
  }, {})

  return (
    <nav className="flex flex-col gap-0.5 p-3 flex-1 overflow-y-auto">
      {ungrouped.map(link => (
        <a
          key={link.href}
          href={link.href}
          className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            pathname === link.href || (link.href !== '/admin/dashboard' && pathname?.startsWith(link.href))
              ? 'bg-white/20 text-white'
              : 'text-gray-300 hover:bg-white/10 hover:text-white'
          }`}
        >
          {link.label}
        </a>
      ))}
      {Object.entries(groups).map(([groupName, links]) => (
        <SidebarGroup
          key={groupName}
          groupName={groupName}
          links={links}
          pathname={pathname}
        />
      ))}
    </nav>
  )
}

function SidebarGroup({ groupName, links, pathname }: { groupName: string; links: NavLink[]; pathname: string | null }) {
  const isAnyActive = links.some(l => pathname === l.href || pathname?.startsWith(l.href))
  const [isOpen, setIsOpen] = useState(isAnyActive)

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
      >
        <span>{groupName}</span>
        <svg
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="ml-3 flex flex-col gap-0.5 mt-0.5">
          {links.map(link => (
            <a
              key={link.href}
              href={link.href}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === link.href || pathname?.startsWith(link.href)
                  ? 'bg-white/20 text-white'
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
