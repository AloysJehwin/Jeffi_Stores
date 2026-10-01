import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Staff Notes',
  description: 'Capture customer notes and photos on the go',
  robots: 'noindex, nofollow',
  manifest: '/staff/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Staff Notes', statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#111827',
}

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-surface text-foreground">{children}</div>
}
