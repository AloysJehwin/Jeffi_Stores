import type { NextRequest } from 'next/server'
import { runWithAuditActor } from '@/lib/auth/audit-context'
import { handleMarketplacePush } from '@/lib/marketplace/push-handler'

export const dynamic = 'force-dynamic'

/** AJIO order pushes; the store is the Host. See lib/marketplace/push-handler. */
export const POST = (request: NextRequest) => runWithAuditActor('ajio', () => handleMarketplacePush('ajio', request))
