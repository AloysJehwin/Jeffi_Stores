'use client'

import { usePathname } from 'next/navigation'

interface NavLink {
  href: string
  label: string
}

export default function AdminSidebarNav({ navLinks }: { navLinks: NavLink[] }) {
  const pathname = usePathname()

  return (
    <nav className="flex flex-col gap-0.5 p-3 flex-1 overflow-y-auto">
      {navLinks.map(link => (
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
    </nav>
  )
}
