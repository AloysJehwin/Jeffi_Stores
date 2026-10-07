import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/shared/db'
import { getStorageDriver } from '@/lib/vault/storage'
import { requireVaultSession } from '@/lib/vault/request-guard'
import { ownedFileById, fileDownloadAllowed, safeContentType } from '@/lib/vault/entitled-files'

// Mints a short-lived signed URL for an OWNED file. No media extension in the path (STATIC_ASSET_RE).
// Inline by default; attachment only when master vaultDownloadsEnabled && file.downloadable.

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_STORE = { 'Cache-Control': 'private, no-store' }

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

function clientNet(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = fwd || request.headers.get('x-real-ip') || ''
  return ip.replace(/\.\d+$/, '.0').slice(0, 64)
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireVaultSession()
    if (!session) return json({ error: 'Unauthorized' }, 401)

    const fileId = request.nextUrl.searchParams.get('file') || ''
    const wantDownload = request.nextUrl.searchParams.get('download') === '1'
    if (!UUID_RE.test(fileId)) return json({ error: 'Invalid file' }, 400)

    const file = await ownedFileById(session.userId, fileId)
    if (!file) return json({ error: 'Not found' }, 404)

    // Refuse rather than fall back to inline: an inline URL must never be handed out as a download.
    if (wantDownload && !(await fileDownloadAllowed(file))) {
      return json({ error: 'Download not available' }, 403)
    }
    const disposition = wantDownload ? 'attachment' : 'inline'

    const url = await getStorageDriver().signDownload(file.storage_key, {
      disposition,
      filename: file.original_name || file.display_name,
      contentType: safeContentType(file.kind, file.mime_type),
    })

    await query(
      `INSERT INTO vault_access_log (user_id, product_id, product_file_id, action, bytes, ip_net, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        session.userId,
        file.product_id,
        file.id,
        disposition === 'attachment' ? 'download' : 'stream',
        file.size_bytes,
        clientNet(request),
        request.headers.get('user-agent')?.slice(0, 1000) ?? null,
      ]
    ).catch(err => console.error('[vault/stream] access log', err))

    return json({ url, disposition, kind: file.kind, mimeType: file.mime_type })
  } catch (err) {
    console.error('[vault/stream]', err)
    return json({ error: 'Failed to open file' }, 500)
  }
}
