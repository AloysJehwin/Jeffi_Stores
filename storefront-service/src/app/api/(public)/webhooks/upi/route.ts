import { NextRequest } from 'next/server'
import { runWithAuditActor } from '@/lib/auth/audit-context'
import { handleUpiWebhook } from '@/lib/payments/upi/handlers'

export const dynamic = 'force-dynamic'

// The platform PhonePe account's webhook; own-account stores use /webhooks/upi/[tenant].
export const POST = (request: NextRequest) => runWithAuditActor('phonepe', () => handleUpiWebhook(request))
