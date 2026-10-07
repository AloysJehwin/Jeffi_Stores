import type { Metadata, Viewport } from 'next'

// The vault is an authenticated, per-buyer surface — never index it, never follow out of it.
export const metadata: Metadata = {
  title: 'Vault',
  description: 'Your purchased digital library',
  robots: 'noindex, nofollow, noarchive, nosnippet',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b0b0f',
}

export default function VaultLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-neutral-950 text-neutral-100">{children}</div>
}
