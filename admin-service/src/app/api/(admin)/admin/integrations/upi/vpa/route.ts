import { NextRequest } from 'next/server'
import { handleUpiVpaPut } from '@/lib/payments/upi/settings'

export const dynamic = 'force-dynamic'

// The merchant's UPI ID (owner only); it decides where UPG payments go.
export const PUT = (request: NextRequest) => handleUpiVpaPut(request)
