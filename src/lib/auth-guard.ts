import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function requireAuth() {
  const cookieStore = cookies()
  const session = cookieStore.get('admin_session')

  if (!session) {
    redirect('/admin/login')
  }

  try {
    const sessionData = JSON.parse(session.value)

    if (Date.now() > sessionData.exp) {
      redirect('/admin/login')
    }

    return sessionData
  } catch (error) {
    redirect('/admin/login')
  }
}
