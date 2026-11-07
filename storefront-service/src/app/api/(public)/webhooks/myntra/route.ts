import type { NextRequest } from 'next/server'
import { runWithAuditActor } from '@/lib/auth/audit-context'
import { handleMarketplacePush } from '@/lib/marketplace/push-handler'

export const dynamic = 'force-dynamic'

/** Myntra order pushes; the store is the Host. See lib/marketplace/push-handler. */
export const POST = (request: NextRequest) => runWithAuditActor('myntra', () => handleMarketplacePush('myntra', request))
