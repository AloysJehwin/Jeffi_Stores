import type { Metadata, Viewport } from 'next'
import VaultShell from '@/components/vault/VaultShell'
import { requireVaultSession } from '@/lib/vault/request-guard'
import { buyerLabel } from '@/lib/vault/entitled-files'
import { storeBaseUrlAsync } from '@/lib/vault/links'
import { getStoreIdentity } from '@/lib/catalog/site-controls'

// The vault is an authenticated, per-buyer surface — never index it, never follow out of it.
export const metadata: Metadata = {
  title: 'Vault',
  description: 'Your purchased digital library',
  robots: 'noindex, nofollow, noarchive, nosnippet',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a0a0a',
}

export default async function VaultLayout({ children }: { children: React.ReactNode }) {
  const [session, identity, storeUrl] = await Promise.all([
    requireVaultSession(),
    getStoreIdentity().catch(() => null),
    storeBaseUrlAsync().catch(() => '/'),
  ])
  const email = session ? session.email ?? (await buyerLabel(session.userId).catch(() => null)) : null

  return (
    <VaultShell
      storeName={identity?.name?.trim() || 'Store'}
      logoUrl={identity?.logoUrl?.trim() || null}
      storeUrl={storeUrl}
      buyer={session ? { name: session.displayName, email } : null}
    >
      {children}
    </VaultShell>
  )
}
