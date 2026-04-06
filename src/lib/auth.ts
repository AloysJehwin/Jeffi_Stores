import { queryOne, query } from './db'
import bcrypt from 'bcrypt'

/**
 * Admin Authentication Functions
 */

// Verify admin credentials
export async function verifyAdminCredentials(username: string, password: string) {
  try {
    const admin = await queryOne(`
      SELECT
        a.*,
        json_build_object(
          'id', u.id, 'email', u.email, 'first_name', u.first_name,
          'last_name', u.last_name, 'is_active', u.is_active
        ) AS users
      FROM admins a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE a.username = $1
    `, [username])

    if (!admin) {
      return { success: false, error: 'Invalid credentials' }
    }

    // Check if user is active
    if (!admin.users?.is_active) {
      return { success: false, error: 'Account is disabled' }
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, admin.password_hash)
    if (!passwordMatch) {
      return { success: false, error: 'Invalid credentials' }
    }

    // Update last login
    await query('UPDATE admins SET last_login = NOW() WHERE id = $1', [admin.id])
    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [admin.user_id])

    return {
      success: true,
      admin: {
        id: admin.id,
        user_id: admin.user_id,
        username: admin.username,
        role: admin.role,
        email: admin.users.email,
        first_name: admin.users.first_name,
        last_name: admin.users.last_name,
      },
    }
  } catch (error) {
    console.error('Admin auth error:', error)
    return { success: false, error: 'Authentication failed' }
  }
}

// Create new admin user
export async function createAdminUser(userData: {
  email: string
  first_name: string
  last_name: string
  phone?: string
  username: string
  password: string
  role?: string
}) {
  try {
    // Hash password
    const passwordHash = await bcrypt.hash(userData.password, 10)

    // Create user first
    const user = await queryOne(
      `INSERT INTO users (email, first_name, last_name, phone)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userData.email, userData.first_name, userData.last_name, userData.phone || null]
    )

    if (!user) throw new Error('Failed to create user')

    // Create admin
    const admin = await queryOne(
      `INSERT INTO admins (user_id, username, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [user.id, userData.username, passwordHash, userData.role || 'admin']
    )

    if (!admin) throw new Error('Failed to create admin')

    return { success: true, admin }
  } catch (error) {
    console.error('Create admin error:', error)
    return { success: false, error: (error as Error).message }
  }
}

// Verify client certificate (called from middleware)
export function verifyClientCertificate(certHeader: string | undefined, certVerified: string | undefined) {
  if (!certHeader || certVerified !== 'SUCCESS') {
    return {
      valid: false,
      error: 'Invalid or missing client certificate',
      details: 'Please install the client certificate (client-cert.p12) in your browser'
    }
  }

  return { valid: true }
}

// Check if user has admin role
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

// Session management helpers
export function createSessionToken(admin: any) {
  return {
    id: admin.id,
    user_id: admin.user_id,
    username: admin.username,
    role: admin.role,
    email: admin.email,
    exp: Date.now() + 30 * 60 * 1000, // 30 minutes
  }
}

export function isSessionValid(session: any) {
  if (!session || !session.exp) return false
  return Date.now() < session.exp
}
