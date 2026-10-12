import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// STUB — AWS End User Messaging (SNS event-destination) delivery/price callback. Implemented during
// the Twilio→AWS migration (Phase 5 of the runbook): parse the SNS envelope, map the message id +
// Meta/AWS price, and call debitMessageCost (same path the Twilio status webhook uses). For now it
// acknowledges so the endpoint exists and SNS subscription setup can be tested.
export async function POST() {
  return new NextResponse(null, { status: 204 })
}
