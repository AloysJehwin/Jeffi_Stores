'use server'

import { cookies} from 'next/headers'
import { redirect } from 'next/navigation'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'

export async function logoutAction() {
  const cookieStore = await cookies()
  cookieStore.delete('admin_token')
  cookieStore.delete('admin_session') // Clear old session cookie too
  const host = await getHost()
  redirect(ap('/admin/login', host))
}
