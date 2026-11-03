import { requireVaultSession } from '@/lib/vault/request-guard'
import { listEntitlements } from '@/lib/vault/entitled-files'
import { storeBaseUrlAsync } from '@/lib/vault/links'
import LibraryGrid from '@/components/vault/LibraryGrid'
import type { LibraryItem } from '@/lib/vault/library-filter'

export const dynamic = 'force-dynamic'

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))

// The buyer's library: every product they hold an active, unexpired, unrevoked entitlement for.
export default async function VaultLibraryPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireVaultSession()
  if (!session) {
    // Middleware bounces an unauthenticated vault request to the store SSO handoff; defensive only.
    return (
      <main className="mx-auto max-w-7xl px-4 py-16 text-center text-neutral-400">Please sign in to view your library.</main>
    )
  }

  const [rows, storeUrl, { q }] = await Promise.all([listEntitlements(session.userId), storeBaseUrlAsync(), searchParams])
  const items: LibraryItem[] = rows
    .map(r => ({
      product_id: r.product_id,
      title: r.title,
      cover_url: r.cover_url,
      source: r.source,
      access_expires_at: iso(r.access_expires_at),
      kinds: r.kinds ?? [],
      file_count: Number(r.file_count) || 0,
      granted_at: iso(r.granted_at) ?? '',
    }))
    .sort((a, b) => b.granted_at.localeCompare(a.granted_at))

  return <LibraryGrid items={items} storeUrl={storeUrl} initialQuery={typeof q === 'string' ? q.slice(0, 100) : ''} />
}
