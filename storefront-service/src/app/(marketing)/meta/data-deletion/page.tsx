import { readDeletionCode } from '@/lib/catalog/meta-privacy'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Data deletion status', robots: { index: false, follow: false } }

// Where Meta's data-deletion callback points the person who asked: the outcome behind their confirmation code.
export default async function MetaDataDeletionPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams
  let status: ReturnType<typeof readDeletionCode> = null
  try {
    status = code ? readDeletionCode(code) : null
  } catch {}

  return (
    <div className="bg-surface min-h-screen">
      <div className="container mx-auto max-w-2xl px-4 py-10 space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Facebook data deletion</h1>
        {status ? (
          <>
            <p className="text-sm text-foreground">
              We received your request through Facebook on{' '}
              {status.at.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })} IST.
            </p>
            <p className="text-sm text-foreground">
              {status.deleted > 0
                ? `It is complete: the ${status.deleted === 1 ? 'connection' : `${status.deleted} connections`} and access tokens we held for your Facebook account were deleted.`
                : 'It is complete: we held no connections or access tokens for your Facebook account.'}
            </p>
            <p className="text-xs text-foreground-muted break-all">Confirmation code: {code}</p>
          </>
        ) : (
          <p className="text-sm text-foreground">
            This confirmation code is not valid. Use the link Facebook gave you after you asked for your data to be deleted.
          </p>
        )}
      </div>
    </div>
  )
}
