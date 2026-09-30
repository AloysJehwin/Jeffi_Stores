import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser } from '@/lib/jwt'
import { fetchUserOrders, getBotPayload } from '@/lib/support-bot'

export async function GET(request: NextRequest) {
  const authUser = await authenticateAnyUser(request)
  if (!authUser) {
    return NextResponse.json({
      reply: null,
      payload: { type: 'text', text: 'your session has expired. please log in again to use support chat.' },
    })
  }

  const msg = request.nextUrl.searchParams.get('msg') || ''
  if (!msg.trim()) {
    return NextResponse.json({ reply: null, payload: { type: 'text', text: 'please select a topic to get started.' } })
  }

  try {
    const orders = await fetchUserOrders(authUser.userId)
    const payload = getBotPayload(msg, orders)
    return NextResponse.json({ payload })
  } catch {
    return NextResponse.json({
      payload: {
        type: 'text_actions',
        text: 'having a bit of trouble fetching your data right now.',
        actions: [
          { label: 'Try Again', query: msg },
          { label: 'Talk to Agent', query: 'connect to agent' },
        ],
      },
    })
  }
}
