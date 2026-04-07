'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function logoutAction() {
  const cookieStore = cookies()
  cookieStore.delete('admin_token')
  cookieStore.delete('admin_session') // Clear old session cookie too
  redirect('/admin/login')
}
