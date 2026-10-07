import Link from 'next/link'
import { requireVaultSession } from '@/lib/vault/request-guard'
import { listEntitlements } from '@/lib/vault/entitled-files'

export const dynamic = 'force-dynamic'

// The buyer's library: every product they hold an active, unexpired, unrevoked entitlement for.
export default async function VaultLibraryPage() {
  const session = await requireVaultSession()
  if (!session) {
    // Middleware (Workstream A) bounces an unauthenticated vault request to the store login + SSO
    // handoff, so this is only a defensive fallback.
    return <Shell><p className="text-neutral-400">Please sign in to view your library.</p></Shell>
  }

  const items = await listEntitlements(session.userId)

  return (
    <Shell>
      {items.length === 0 ? (
        <p className="text-neutral-400">Your library is empty. Digital purchases appear here.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map(it => (
            <li key={it.product_id} className="group rounded-lg border border-neutral-800 bg-neutral-900 overflow-hidden">
              <Link href={`/item/${encodeURIComponent(it.product_id)}`} className="block">
                <div className="aspect-[3/4] bg-neutral-800">
                  {it.cover_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.cover_url} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : null}
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 text-sm font-medium">{it.title}</p>
                  {it.access_expires_at ? (
                    <p className="mt-1 text-xs text-amber-400">
                      Access until {new Date(it.access_expires_at).toLocaleDateString()}
                    </p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">Your library</h1>
      {children}
    </main>
  )
}
