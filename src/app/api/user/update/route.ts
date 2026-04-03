import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { jwtVerify } from 'jose'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key')

export async function PATCH(request: NextRequest) {
  try {
    // Get auth token
    const token = cookies().get('auth_token')?.value

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify JWT
    let userId: string
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET)
      userId = payload.userId as string
    } catch (error) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Get update data
    const body = await request.json()
    const { firstName, lastName, phone } = body

    if (!firstName) {
      return NextResponse.json({ error: 'First name is required' }, { status: 400 })
    }

    // Update user profile
    const { data: updatedUser, error } = await supabaseAdmin
      .from('users')
      .update({
        first_name: firstName,
        last_name: lastName || null,
        phone: phone || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single()

    if (error) {
      console.error('Error updating user:', error)
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
    }

    // Transform to camelCase
    const user = {
      id: updatedUser.id,
      email: updatedUser.email,
      firstName: updatedUser.first_name,
      lastName: updatedUser.last_name,
      phone: updatedUser.phone,
      createdAt: updatedUser.created_at,
    }

    return NextResponse.json({ user })
  } catch (error) {
    console.error('Error in user update API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
