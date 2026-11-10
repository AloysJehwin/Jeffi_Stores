import { NextRequest } from 'next/server'
import { runWithAuditActor } from '@/lib/auth/audit-context'
import { handleUpiWebhook } from '@/lib/payments/upi/handlers'

export const dynamic = 'force-dynamic'

// A store's own PhonePe account: verified with that store's webhook credentials only.
export const POST = (request: NextRequest, { params }: { params: Promise<{ tenant: string }> }) =>
  runWithAuditActor('phonepe', async () => handleUpiWebhook(request, (await params).tenant))
