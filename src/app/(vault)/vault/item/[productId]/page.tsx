import Link from 'next/link'
import { ChevronRight, Clock, Infinity as InfinityIcon, Layers, Repeat } from 'lucide-react'
import { requireVaultSession } from '@/lib/vault/request-guard'
import {
  ownedFilesForProduct,
  entitlementSummary,
  fileDownloadAllowed,
  buyerLabel,
  type OwnedFile,
} from '@/lib/vault/entitled-files'
import { currentBrandNameAsync } from '@/lib/catalog/brand'
import { KIND_LABEL, accessLabel, primaryKind } from '@/lib/vault/library-filter'
import ContentGuard from '@/components/vault/ContentGuard'
import ItemViewer, { type ViewerFile } from '@/components/vault/ItemViewer'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function VaultItemPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params
  const session = await requireVaultSession()
  if (!session) {
    return <Shell><p className="text-neutral-400">Please sign in to open this item.</p></Shell>
  }

  const valid = UUID_RE.test(productId)
  const [files, ent] = valid
    ? await Promise.all([ownedFilesForProduct(session.userId, productId), entitlementSummary(session.userId, productId)])
    : [[], null]
  if (files.length === 0 || !ent) {
    return (
      <Shell>
        <Breadcrumb />
        <div className="rounded-2xl border border-white/[0.06] px-6 py-16 text-center">
          <p className="font-medium text-neutral-200">Item unavailable</p>
          <p className="mt-1 text-sm text-neutral-500">
            You don&apos;t have access to this item, or it has no readable files yet.
          </p>
          <Link href="/library" className="mt-5 inline-block rounded-lg bg-white/[0.08] px-4 py-2 text-sm text-neutral-100 hover:bg-white/[0.12]">
            Back to library
          </Link>
        </div>
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
  const reference = ent.order_number || ent.id.slice(0, 8)
  const watermark = { buyer, store, reference, timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }
  const expires = ent.access_expires_at ? new Date(ent.access_expires_at).toISOString() : null
  const kind = primaryKind(files.map(f => f.kind))

  return (
    <Shell>
      <Breadcrumb title={ent.title} />
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{ent.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <Pill>{KIND_LABEL[kind]}</Pill>
          <Pill>
            <Layers className="h-3.5 w-3.5" aria-hidden />
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </Pill>
          <Pill tone={expires ? 'amber' : 'neutral'}>
            {expires ? <Clock className="h-3.5 w-3.5" aria-hidden /> : <InfinityIcon className="h-3.5 w-3.5" aria-hidden />}
            {accessLabel(expires)}
          </Pill>
          {ent.source === 'subscription' ? (
            <Pill tone="indigo">
              <Repeat className="h-3.5 w-3.5" aria-hidden />
              Subscription
            </Pill>
          ) : null}
        </div>
      </header>
      <ContentGuard watermark={watermark}>
        <ItemViewer files={viewerFiles} />
      </ContentGuard>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">{children}</main>
}

function Breadcrumb({ title }: { title?: string }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm text-neutral-500">
        <li>
          <Link href="/library" className="rounded hover:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
            Library
          </Link>
        </li>
        {title ? (
          <>
            <li aria-hidden><ChevronRight className="h-4 w-4" /></li>
            <li aria-current="page" className="min-w-0 truncate text-neutral-300">{title}</li>
          </>
        ) : null}
      </ol>
    </nav>
  )
}

const PILL_TONE = {
  neutral: 'bg-white/[0.05] text-neutral-300 ring-white/[0.08]',
  amber: 'bg-amber-400/10 text-amber-200 ring-amber-300/20',
  indigo: 'bg-indigo-500/15 text-indigo-200 ring-indigo-400/25',
} as const

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: keyof typeof PILL_TONE }) {
  return <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ring-1 ring-inset ${PILL_TONE[tone]}`}>{children}</span>
}
