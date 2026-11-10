import { NextRequest } from 'next/server'
import { handleUpiSettingsGet } from '@/lib/payments/upi/settings'

export const dynamic = 'force-dynamic'

// What Site Controls → UPI collection shows: provider, UPI ID, bank alerts, PhonePe.
export const GET = (request: NextRequest) => handleUpiSettingsGet(request)
