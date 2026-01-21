import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const orderId = params.id
    const body = await request.json()
    const { status, payment_status } = body

    const updateData: any = {
      updated_at: new Date().toISOString(),
    }

    if (status) {
      updateData.status = status
    }

    if (payment_status) {
      updateData.payment_status = payment_status
    }

    const { error } = await supabaseAdmin
      .from('orders')
      .update(updateData)
      .eq('id', orderId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Update error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update order' },
      { status: 500 }
    )
  }
}
