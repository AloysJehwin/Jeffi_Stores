'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ap } from '@/lib/admin-path'

export async function logoutAction() {
  const cookieStore = cookies()
  cookieStore.delete('admin_token')
  cookieStore.delete('admin_session') // Clear old session cookie too
  const host = (await headers()).get('host') ?? ''
  redirect(ap('/admin/login', host))
}
