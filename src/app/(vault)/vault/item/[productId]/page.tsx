import Link from 'next/link'
import { requireVaultSession } from '@/lib/vault/request-guard'
import {
  ownedFilesForProduct,
  fileDownloadAllowed,
  buyerLabel,
  type OwnedFile,
} from '@/lib/vault/entitled-files'
import { currentBrandNameAsync } from '@/lib/catalog/brand'
import ContentGuard from '@/components/vault/ContentGuard'
import ItemViewer, { type ViewerFile } from '@/components/vault/ItemViewer'

export const dynamic = 'force-dynamic'

export default async function VaultItemPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params
  const session = await requireVaultSession()
  if (!session) {
    return <Shell><p className="text-neutral-400">Please sign in to open this item.</p></Shell>
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const files = UUID_RE.test(productId) ? await ownedFilesForProduct(session.userId, productId) : []
  if (files.length === 0) {
    return (
      <Shell>
        <p className="text-neutral-400">
          You don&apos;t have access to this item, or it has no readable files.
        </p>
        <Link href="/library" className="mt-4 inline-block text-sm text-indigo-400">← Back to library</Link>
      </Shell>
    )
  }

  // Compute the effective download gate per file on the server; the client never decides it.
  const viewerFiles: ViewerFile[] = await Promise.all(
    files.map(async (f: OwnedFile) => ({
      id: f.id,
      kind: f.kind,
      displayName: f.display_name,
      pageCount: f.page_count,
      downloadAllowed: await fileDownloadAllowed(f),
    }))
  )

  const [buyer, store] = await Promise.all([buyerLabel(session.userId), currentBrandNameAsync()])
  const watermark = { buyer, store, timestamp: new Date().toISOString() }

  return (
    <Shell>
      <Link href="/library" className="mb-4 inline-block text-sm text-indigo-400">← Library</Link>
      <ContentGuard watermark={watermark}>
        <ItemViewer files={viewerFiles} />
      </ContentGuard>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
}
