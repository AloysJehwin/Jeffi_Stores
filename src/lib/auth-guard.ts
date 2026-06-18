import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ap } from '@/lib/admin-path'

export async function requireAuth() {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')
  const host = (await headers()).get('host') ?? ''

  if (!session) {
    redirect(ap('/admin/login', host))
  }

  try {
    const sessionData = JSON.parse(session.value)

    if (Date.now() > sessionData.exp) {
      redirect(ap('/admin/login', host))
    }

    return sessionData
  } catch (error) {
    redirect(ap('/admin/login', host))
  }
}
