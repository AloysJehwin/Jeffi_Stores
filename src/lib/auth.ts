import { queryOne, query } from './db'

export async function createAdminUser(userData: {
  email: string
  first_name: string
  last_name: string
  phone?: string
  role?: string
  scopes?: string[]
}) {
  try {
    let user = await queryOne(
      `SELECT u.* FROM users u
       LEFT JOIN admins a ON a.user_id = u.id
       WHERE u.email = $1 AND a.id IS NULL`,
      [userData.email]
    )

    if (user) {
      user = await queryOne(
        `UPDATE users SET first_name = $1, last_name = $2, phone = $3 WHERE id = $4 RETURNING *`,
        [userData.first_name, userData.last_name, userData.phone || null, user.id]
      )
    } else {
      user = await queryOne(
        `INSERT INTO users (email, first_name, last_name, phone)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [userData.email, userData.first_name, userData.last_name, userData.phone || null]
      )
    }

    if (!user) throw new Error('Failed to create user')

    const admin = await queryOne(
      `INSERT INTO admins (user_id, role, scopes)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [user.id, userData.role || 'admin', JSON.stringify(userData.scopes || [])]
    )

    if (!admin) throw new Error('Failed to create admin')

    return { success: true, admin }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

export function hasAdminRole(session: any, requiredRole: string = 'admin') {
  if (!session?.admin) return false

  const roleHierarchy: Record<string, number> = {
    super_admin: 3,
    admin: 2,
    moderator: 1,
  }

  const userRoleLevel = roleHierarchy[session.admin.role] || 0
  const requiredRoleLevel = roleHierarchy[requiredRole] || 0

  return userRoleLevel >= requiredRoleLevel
}

export function isSessionValid(session: any) {
  if (!session || !session.exp) return false
  return Date.now() < session.exp
}
